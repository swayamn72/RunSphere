import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  TerritoryConcentrationListResponseSchema,
  TerritoryLadderResponseSchema,
  TerritoryMapResponseSchema,
  TerritorySeasonParamsSchema,
  TerritoryWeekListResponseSchema,
  TerritoryWeekParamsSchema,
  TerritoryWeekRollbackRequestSchema,
  type TerritoryConcentrationListResponse,
  type TerritoryLadderResponse,
  type TerritoryMapResponse,
  type TerritorySeasonParams,
  type TerritoryWeekListResponse,
  type TerritoryWeekParams,
  type TerritoryWeekRollbackRequest
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  TERRITORY_CAPTURE_NOTE,
  canOperateCompetitions,
  canRollBackTerritoryWeek,
  concentrationPausesAwards,
  territoryWeekOf
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * The season ladder, the map, concentration monitoring, and week rollback
 * (Phase 4, milestones 4.4, 4.5 and 4.6).
 *
 * Territory capture is still off, so every read here returns an empty season
 * and says so. They are written now because what they return is a privacy
 * decision, and a privacy decision is easier to review as a schema and a query
 * than as a promise about what a future route will do.
 *
 * The decision worth arguing with at the Territory gate: **the ladder carries
 * no identities at all.** See `TerritoryLadderResponseSchema` for why.
 */
export interface TerritorySeasonRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

/**
 * Said wherever the map appears. It states the two things a person cannot see
 * from the picture itself: that the areas are not attributed to anybody, and
 * that they reset every week.
 */
export const TERRITORY_MAP_NOTE =
  'This map shows which areas are held this week and which of them are yours. It never shows who holds the others, when anyone was there, or the path anyone took. Areas reset every week.';

/**
 * Said in the app's own words wherever the ladder appears, so a participant who
 * expects names is told why there are none rather than assuming the feature is
 * broken or that nobody else has joined.
 */
export const TERRITORY_LADDER_NOTE =
  'Territory standings are shown without names. Points come from where people moved in public space, so this shows your division and where you sit in it, never who is above or below you.';

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const value = request.headers.authorization;
  const accountId = value?.startsWith('Bearer ')
    ? verifyAccessToken(value.slice(7), secret)
    : undefined;
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

const staffRoles = async (database: Database, accountId: string): Promise<string[]> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1',
    [accountId]
  );
  return result.rows.map((row) => row.role);
};

/** One page of a division's ladder is bounded by the contract's 200 entries. */
const LADDER_PAGE = 200;

export const registerTerritorySeasonRoutes = ({
  routes,
  database,
  authSecret
}: TerritorySeasonRouteDeps): void => {
  /**
   * The reader's division ladder.
   *
   * A reader who has not enrolled gets a ladder with no division and no
   * entries rather than an error: not having joined is an ordinary state of the
   * screen, and divisions are isolated (`product.md`), so there is genuinely
   * nothing they are entitled to see.
   *
   * The reader's own row is always included even when their rank falls outside
   * the page, because a ladder that cannot show somebody their own position is
   * not answering the only question they came with.
   */
  routes.get<{ Params: TerritorySeasonParams }>(
    '/v1/territory/seasons/:seasonId/ladder',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        response: {
          200: TerritoryLadderResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const season = await database.query<{ id: string }>(
        'SELECT id FROM territory_seasons WHERE id = $1',
        [request.params.seasonId]
      );
      if (!season.rows[0]) return reply.code(404).send({ message: 'Season not found' });

      const enrollment = await database.query<{ division: string }>(
        `SELECT division FROM territory_enrollments
         WHERE season_id = $1 AND account_id = $2 AND withdrawn_at IS NULL`,
        [request.params.seasonId, accountId]
      );
      const division = enrollment.rows[0]?.division;
      const base: TerritoryLadderResponse = {
        seasonId: request.params.seasonId,
        participantCount: 0,
        entries: [],
        captureNote: TERRITORY_CAPTURE_NOTE,
        ladderNote: TERRITORY_LADDER_NOTE
      };
      if (!division) return base;

      // Ranked across the whole division, then narrowed to a page plus the
      // reader's own row. Equal points share a rank (`rank()`, not
      // `row_number()`), which is the same rule the season standings use.
      const ladder = await database.query<{
        account_id: string;
        points: number;
        weeks_scored: number;
        position: string;
        total: string;
      }>(
        `WITH ranked AS (
           SELECT account_id, points, weeks_scored,
             rank() OVER (ORDER BY points DESC) AS position,
             count(*) OVER () AS total
           FROM territory_season_standings
           WHERE season_id = $1 AND division = $2
         )
         SELECT account_id, points, weeks_scored, position::text AS position, total::text AS total
         FROM ranked
         WHERE position <= $3 OR account_id = $4
         ORDER BY position, account_id
         LIMIT $3 + 1`,
        [request.params.seasonId, division, LADDER_PAGE, accountId]
      );

      return {
        ...base,
        division,
        participantCount: Number(ladder.rows[0]?.total ?? 0),
        entries: ladder.rows.map((row) => ({
          rank: Number(row.position),
          points: Number(row.points),
          weeksScored: Number(row.weeks_scored),
          isSelf: row.account_id === accountId
        }))
      };
    }
  );

  /**
   * The season map for the current week (milestone 4.5, ADR-0008).
   *
   * A cell is an index and one bit: whether the reader holds it. There is no
   * holder, no time, no count, and no route — the whole of what ADR-0008 says
   * another participant's cell may expose is "it is held", and this returns
   * exactly that and nothing more.
   *
   * Only the reader's own division is drawn. Divisions are isolated for rank
   * and awards (`product.md`), and a map spanning all of them would let anybody
   * read the whole city's activity off a screen meant to show their own game.
   */
  routes.get<{ Params: TerritorySeasonParams }>(
    '/v1/territory/seasons/:seasonId/map',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        response: {
          200: TerritoryMapResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const season = await database.query<{ id: string; h3_resolution: number }>(
        'SELECT id, h3_resolution FROM territory_seasons WHERE id = $1',
        [request.params.seasonId]
      );
      const found = season.rows[0];
      if (!found) return reply.code(404).send({ message: 'Season not found' });

      const base: TerritoryMapResponse = {
        seasonId: request.params.seasonId,
        h3Resolution: Number(found.h3_resolution),
        cells: [],
        captureNote: TERRITORY_CAPTURE_NOTE,
        mapNote: TERRITORY_MAP_NOTE
      };
      const enrollment = await database.query<{ division: string }>(
        `SELECT division FROM territory_enrollments
         WHERE season_id = $1 AND account_id = $2 AND withdrawn_at IS NULL`,
        [request.params.seasonId, accountId]
      );
      const division = enrollment.rows[0]?.division;
      if (!division) return base;

      const weekStartsOn = territoryWeekOf(new Date());
      // The week's *current* snapshot version, so a rolled-back week draws what
      // it now says rather than what it said before the rollback.
      const cells = await database.query<{ cell_index: string; is_self: boolean }>(
        `SELECT control.cell_index,
           (control.controlling_participant_ref = $3) AS is_self
         FROM territory_cell_control control
         JOIN territory_week_state state ON state.season_id = control.season_id
           AND state.week_starts_on = control.week_starts_on
           AND state.current_version = control.version
         JOIN territory_season_standings holder ON holder.season_id = control.season_id
           AND holder.account_id = control.controlling_participant_ref
           AND holder.division = $4
         WHERE control.season_id = $1 AND control.week_starts_on = $2::date
         ORDER BY control.cell_index
         LIMIT 2000`,
        [request.params.seasonId, weekStartsOn, accountId, division]
      );

      return {
        ...base,
        weekStartsOn,
        cells: cells.rows.map((row) => ({ cellIndex: row.cell_index, isSelf: row.is_self }))
      };
    }
  );

  /**
   * Concentration monitoring for one season (`product.md`, milestone 4.6).
   *
   * Staff work, and a read only: no route pauses awards or moves anybody. Seven
   * consecutive breached days is an instruction to people — pause awards
   * analysis, investigate cell scarcity and validation abuse — and automating
   * a response to it would take a judgement away from whoever should be making
   * it.
   */
  routes.get<{ Params: TerritorySeasonParams }>(
    '/v1/staff/territory/seasons/:seasonId/concentration',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        response: {
          200: TerritoryConcentrationListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canOperateCompetitions(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'A season needs a season operator role' });

      const checks = await database.query<{
        division: string;
        observed_on: string;
        participants: number;
        top_decile_share: string;
        top_participant_share: string;
        applicable: boolean;
        breached: boolean;
        breach_run_days: number;
      }>(
        `SELECT division, observed_on::text AS observed_on, participants, top_decile_share,
           top_participant_share, applicable, breached, breach_run_days
         FROM territory_concentration_checks
         WHERE season_id = $1 AND observed_on >= current_date - 30
         ORDER BY observed_on DESC, division
         LIMIT 200`,
        [request.params.seasonId]
      );
      const response: TerritoryConcentrationListResponse = {
        data: checks.rows.map((row) => ({
          division: row.division,
          observedOn: row.observed_on,
          participants: Number(row.participants),
          topDecileShare: Number(row.top_decile_share),
          topParticipantShare: Number(row.top_participant_share),
          applicable: row.applicable,
          breached: row.breached,
          breachRunDays: Number(row.breach_run_days),
          pausesAwards: concentrationPausesAwards(Number(row.breach_run_days))
        }))
      };
      return response;
    }
  );

  /**
   * The finalized weeks of a season and the snapshot version each is showing.
   *
   * `latestVersion` beside `currentVersion` is what makes a rollback legible:
   * a week showing version 1 when version 2 exists has been rolled back, and
   * the list says so rather than leaving somebody to compare two tables.
   */
  routes.get<{ Params: TerritorySeasonParams }>(
    '/v1/staff/territory/seasons/:seasonId/weeks',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        response: {
          200: TerritoryWeekListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canOperateCompetitions(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'A season needs a season operator role' });

      const weeks = await database.query<{
        week_starts_on: string;
        current_version: number;
        latest_version: number;
        finalized_at: Date;
      }>(
        `SELECT state.week_starts_on::text AS week_starts_on, state.current_version,
           coalesce((SELECT max(control.version) FROM territory_cell_control control
             WHERE control.season_id = state.season_id
               AND control.week_starts_on = state.week_starts_on), state.current_version)
             AS latest_version,
           state.finalized_at
         FROM territory_week_state state
         WHERE state.season_id = $1
         ORDER BY state.week_starts_on DESC
         LIMIT 100`,
        [request.params.seasonId]
      );
      const response: TerritoryWeekListResponse = {
        data: weeks.rows.map((row) => ({
          weekStartsOn: row.week_starts_on,
          currentVersion: Number(row.current_version),
          latestVersion: Number(row.latest_version),
          finalizedAt: row.finalized_at.toISOString(),
          rolledBack: Number(row.current_version) < Number(row.latest_version)
        }))
      };
      return response;
    }
  );

  /**
   * Roll a week back to an earlier snapshot (milestone 4.6, ADR-0008).
   *
   * Nothing is edited or deleted: the week's pointer moves to a version that
   * already exists, and the move itself is recorded with a staff-written
   * reason. The ladder follows on the next sweep, because season standings are
   * a full recompute from whichever version each week is showing.
   *
   * Rolling forward is deliberately not possible here. A newer snapshot comes
   * from recomputing the week, which is a different act with a different
   * record, and offering both behind one verb would make the audit trail read
   * as though corrections and reversals were the same thing.
   */
  routes.post<{ Params: TerritoryWeekParams; Body: TerritoryWeekRollbackRequest }>(
    '/v1/staff/territory/seasons/:seasonId/weeks/:weekStartsOn/rollback',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritoryWeekParamsSchema,
        body: TerritoryWeekRollbackRequestSchema,
        response: {
          200: TerritoryWeekListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canOperateCompetitions(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'A season needs a season operator role' });

      const state = await database.query<{ current_version: number; finalized_at: Date }>(
        `SELECT current_version, finalized_at FROM territory_week_state
         WHERE season_id = $1 AND week_starts_on = $2::date`,
        [request.params.seasonId, request.params.weekStartsOn]
      );
      const current = state.rows[0];
      if (!current) return reply.code(404).send({ message: 'That week has not been finalized' });

      const toVersion = request.body.toVersion;
      if (!canRollBackTerritoryWeek(Number(current.current_version), toVersion))
        return reply
          .code(422)
          .send({ message: 'A rollback must name an earlier version than the one in use' });

      // The version has to exist as a snapshot. Pointing a week at a version
      // nobody computed would empty it silently.
      const target = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_cell_control
         WHERE season_id = $1 AND week_starts_on = $2::date AND version = $3`,
        [request.params.seasonId, request.params.weekStartsOn, toVersion]
      );
      if (Number(target.rows[0]?.count ?? 0) === 0)
        return reply.code(422).send({ message: 'That snapshot version does not exist' });

      await withTransaction(database, async (client) => {
        await client.query(
          `INSERT INTO territory_week_rollbacks (season_id, week_starts_on, from_version,
             to_version, reason, staff_account_id)
           VALUES ($1, $2::date, $3, $4, $5, $6)`,
          [
            request.params.seasonId,
            request.params.weekStartsOn,
            Number(current.current_version),
            toVersion,
            request.body.reason.trim(),
            accountId
          ]
        );
        await client.query(
          `UPDATE territory_week_state SET current_version = $3, updated_at = now()
           WHERE season_id = $1 AND week_starts_on = $2::date`,
          [request.params.seasonId, request.params.weekStartsOn, toVersion]
        );
        await client.query(
          `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
           VALUES ($1, 'territory.week_rolled_back', 'territory_week', 1)`,
          [accountId]
        );
      });

      const latest = await database.query<{ latest_version: number }>(
        `SELECT coalesce(max(version), $3) AS latest_version FROM territory_cell_control
         WHERE season_id = $1 AND week_starts_on = $2::date`,
        [request.params.seasonId, request.params.weekStartsOn, toVersion]
      );
      const latestVersion = Number(latest.rows[0]?.latest_version ?? toVersion);
      const response: TerritoryWeekListResponse = {
        data: [
          {
            weekStartsOn: request.params.weekStartsOn,
            currentVersion: toVersion,
            latestVersion,
            finalizedAt: current.finalized_at.toISOString(),
            rolledBack: toVersion < latestVersion
          }
        ]
      };
      return response;
    }
  );
};
