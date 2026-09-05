import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  DivisionSizeListResponseSchema,
  ErrorResponseSchema,
  TerritoryEnrollmentRequestSchema,
  TerritorySeasonCreateRequestSchema,
  TerritorySeasonParamsSchema,
  TerritorySeasonResponseSchema,
  TerritorySeasonStatusRequestSchema,
  type TerritoryEnrollmentRequest,
  type TerritorySeasonCreateRequest,
  type TerritorySeasonParams,
  type TerritorySeasonResponse,
  type TerritorySeasonStatusRequest,
  type TerritorySeasonView,
  type TerritoryStatus
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  TERRITORY_CAPTURE_ENABLED,
  TERRITORY_CAPTURE_NOTE,
  canOperateCompetitions,
  divisionSizeAdvice,
  parseTerritoryRule,
  territoryDivisionFor,
  territoryEnrollmentOpen
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * Territory seasons and enrollment (Phase 4, milestone 4.1).
 *
 * **No route here captures a cell, reads a location, or calculates a rank.**
 * Territory capture is disabled until the Territory gate passes (ADR-0008), and
 * this file is what exists before it: a season people can be told about, an
 * opt-in, and a division.
 *
 * The rule worth stating twice: a division is assigned once, at enrollment,
 * from a published activity-history band. Withdrawing and re-joining keeps the
 * division already assigned, so leaving is not a way to reroll it, and no
 * amount of later activity moves anybody mid-season (`product.md`).
 */
export interface TerritoryRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

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

interface SeasonRow {
  id: string;
  title: string;
  status: TerritoryStatus;
  starts_at: Date;
  ends_at: Date;
  privacy_policy_version: string;
  participant_count: string;
  division: string | null;
  prior_active_weeks: number | null;
  enrolled_at: Date | null;
}

const seasonView = (row: SeasonRow): TerritorySeasonView => ({
  id: row.id,
  title: row.title,
  status: row.status,
  startsAt: row.starts_at.toISOString(),
  endsAt: row.ends_at.toISOString(),
  joinable: territoryEnrollmentOpen(row.status),
  captureEnabled: TERRITORY_CAPTURE_ENABLED,
  participantCount: Number(row.participant_count ?? 0),
  ...(row.division && row.enrolled_at
    ? {
        enrollment: {
          division: row.division,
          priorActiveWeeks: row.prior_active_weeks ?? 0,
          enrolledAt: row.enrolled_at.toISOString()
        }
      }
    : {}),
  privacyPolicyVersion: row.privacy_policy_version
});

/**
 * The season a member is being shown: the one accepting or running, or failing
 * that the most recently announced. An ended season is not surfaced — it is
 * over, and a screen still showing it would read as something to join.
 */
const currentSeason = async (
  database: Database,
  accountId: string
): Promise<SeasonRow | undefined> => {
  const result = await database.query<SeasonRow>(
    `SELECT season.id, season.title, season.status, season.starts_at, season.ends_at,
       season.privacy_policy_version,
       (SELECT count(*) FROM territory_enrollments live
         WHERE live.season_id = season.id AND live.withdrawn_at IS NULL)::text
         AS participant_count,
       enrollment.division, enrollment.prior_active_weeks, enrollment.enrolled_at
     FROM territory_seasons season
     LEFT JOIN territory_enrollments enrollment ON enrollment.season_id = season.id
       AND enrollment.account_id = $1 AND enrollment.withdrawn_at IS NULL
     WHERE season.status <> 'ended'
     ORDER BY CASE season.status WHEN 'live' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
       season.starts_at
     LIMIT 1`,
    [accountId]
  );
  return result.rows[0];
};

/**
 * How many earlier Kolkata weeks this account was active in — the only input to
 * a division. A count of weeks, never a score, a pace, or a place, and the same
 * band the global board and competition eligibility read.
 */
const priorActiveWeeks = async (database: Database, accountId: string): Promise<number> => {
  const result = await database.query<{ weeks: string }>(
    `SELECT count(DISTINCT date_trunc('week', processed_at AT TIME ZONE 'Asia/Kolkata'))::text
       AS weeks
     FROM activity_submissions
     WHERE account_id = $1 AND status = 'derived' AND deleted_at IS NULL`,
    [accountId]
  );
  return Number(result.rows[0]?.weeks ?? 0);
};

export const registerTerritoryRoutes = ({
  routes,
  database,
  authSecret
}: TerritoryRouteDeps): void => {
  /**
   * The current season, or none.
   *
   * `captureNote` is returned either way, because "territory does not capture
   * anything yet" is true whether or not a season exists, and a client that
   * only heard it in one branch would eventually show the other.
   */
  routes.get(
    '/v1/territory/season',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritorySeasonResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const season = await currentSeason(database, accountId);
      const response: TerritorySeasonResponse = {
        ...(season ? { season: seasonView(season) } : {}),
        captureNote: TERRITORY_CAPTURE_NOTE
      };
      return response;
    }
  );

  /**
   * Join or leave the season.
   *
   * The division is decided here, once, and stored with the band it was read
   * from so it can be explained to the person it was assigned to. Re-joining
   * reopens the existing row **without recomputing the division**: leaving is
   * not a way to reroll it, and `product.md` permits rebalancing between
   * seasons only.
   */
  routes.put<{ Params: TerritorySeasonParams; Body: TerritoryEnrollmentRequest }>(
    '/v1/territory/seasons/:seasonId/enrollment',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        body: TerritoryEnrollmentRequestSchema,
        response: {
          200: TerritorySeasonResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const found = await database.query<{ id: string; status: TerritoryStatus }>(
        'SELECT id, status FROM territory_seasons WHERE id = $1',
        [request.params.seasonId]
      );
      const season = found.rows[0];
      if (!season) return reply.code(404).send({ message: 'Season not found' });

      if (request.body.enrolled) {
        if (!territoryEnrollmentOpen(season.status))
          return reply.code(409).send({ message: 'That season is not open for enrollment' });

        const published = await database.query<{ definition: unknown }>(
          `SELECT definition FROM rule_versions
           WHERE kind = 'territory' AND superseded_at IS NULL
           ORDER BY version DESC LIMIT 1`
        );
        const definition = published.rows[0]?.definition;
        // No published bands means no defensible division, and inventing one
        // would put somebody in a cohort nobody agreed to.
        if (!definition)
          return reply.code(422).send({ message: 'No territory division rule is published' });

        const weeks = await priorActiveWeeks(database, accountId);
        const division = territoryDivisionFor(weeks, parseTerritoryRule(definition));
        await database.query(
          `INSERT INTO territory_enrollments (season_id, account_id, division, prior_active_weeks)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (season_id, account_id) DO UPDATE SET withdrawn_at = NULL`,
          [season.id, accountId, division, weeks]
        );
      } else {
        await database.query(
          `UPDATE territory_enrollments SET withdrawn_at = now()
           WHERE season_id = $1 AND account_id = $2 AND withdrawn_at IS NULL`,
          [season.id, accountId]
        );
      }
      await database.query(
        `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type,
           resource_id, metadata)
         VALUES ($1, $1, $2, 'territory_season', $3, '{}'::jsonb)`,
        [accountId, request.body.enrolled ? 'territory.enrolled' : 'territory.withdrawn', season.id]
      );

      const updated = await currentSeason(database, accountId);
      const response: TerritorySeasonResponse = {
        ...(updated ? { season: seasonView(updated) } : {}),
        captureNote: TERRITORY_CAPTURE_NOTE
      };
      return response;
    }
  );

  /**
   * Announce a season. Staff work: `season_operator` or `admin`, the same role
   * that runs competitions.
   *
   * Created as `announced`: describing a season and opening it are separate
   * acts, as they are for a competition. There is no route to `live` — that
   * status means the engine is running, and the engine does not exist.
   */
  routes.post<{ Body: TerritorySeasonCreateRequest }>(
    '/v1/staff/territory/seasons',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        body: TerritorySeasonCreateRequestSchema,
        response: {
          201: TerritorySeasonResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
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

      const published = await database.query<{ version: number }>(
        `SELECT version FROM rule_versions
         WHERE kind = 'territory' AND superseded_at IS NULL
         ORDER BY version DESC LIMIT 1`
      );
      const scoringRuleVersion = published.rows[0]?.version;
      if (!scoringRuleVersion)
        return reply.code(422).send({ message: 'No territory rule is published' });

      const created = await database.query<SeasonRow>(
        `INSERT INTO territory_seasons (title, starts_at, ends_at, h3_resolution,
           scoring_rule_version, privacy_policy_version, created_by_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, status, starts_at, ends_at, privacy_policy_version,
           '0' AS participant_count, NULL AS division, NULL AS prior_active_weeks,
           NULL AS enrolled_at`,
        [
          request.body.title.trim(),
          request.body.startsAt,
          request.body.endsAt,
          request.body.h3Resolution,
          scoringRuleVersion,
          request.body.privacyPolicyVersion,
          accountId
        ]
      );
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'territory.season_announced', 'territory_season', 1)`,
        [accountId]
      );
      const response: TerritorySeasonResponse = {
        season: seasonView(created.rows[0]!),
        captureNote: TERRITORY_CAPTURE_NOTE
      };
      return reply.code(201).send(response);
    }
  );

  /**
   * Open enrollment on an announced season, or end a season.
   *
   * `live` is deliberately not reachable: it would say the engine is running.
   * Ending is available from any state, because a season nobody can run should
   * be closable without pretending it ran.
   */
  routes.post<{ Params: TerritorySeasonParams; Body: TerritorySeasonStatusRequest }>(
    '/v1/staff/territory/seasons/:seasonId/status',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        body: TerritorySeasonStatusRequestSchema,
        response: {
          200: TerritorySeasonResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
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

      const changed =
        request.body.status === 'open'
          ? await database.query<SeasonRow>(
              `UPDATE territory_seasons SET status = 'open', opened_at = now()
               WHERE id = $1 AND status = 'announced'
               RETURNING id, title, status, starts_at, ends_at, privacy_policy_version,
                 '0' AS participant_count, NULL AS division, NULL AS prior_active_weeks,
                 NULL AS enrolled_at`,
              [request.params.seasonId]
            )
          : await database.query<SeasonRow>(
              `UPDATE territory_seasons SET status = 'ended', ended_at = now()
               WHERE id = $1 AND status <> 'ended'
               RETURNING id, title, status, starts_at, ends_at, privacy_policy_version,
                 '0' AS participant_count, NULL AS division, NULL AS prior_active_weeks,
                 NULL AS enrolled_at`,
              [request.params.seasonId]
            );
      const row = changed.rows[0];
      if (!row) {
        const existing = await database.query<{ id: string }>(
          'SELECT id FROM territory_seasons WHERE id = $1',
          [request.params.seasonId]
        );
        return existing.rows[0]
          ? reply.code(409).send({ message: 'That season is not in a state for that change' })
          : reply.code(404).send({ message: 'Season not found' });
      }
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, $2, 'territory_season', 1)`,
        [
          accountId,
          request.body.status === 'open' ? 'territory.season_opened' : 'territory.season_ended'
        ]
      );
      const response: TerritorySeasonResponse = {
        season: seasonView(row),
        captureNote: TERRITORY_CAPTURE_NOTE
      };
      return response;
    }
  );

  /**
   * Division sizes for one season, with advice for the *next* season start.
   *
   * `product.md` targets 100–250 per division, merging below 40 and splitting
   * above 300, at season start only. This reports; it never moves anybody,
   * because moving somebody mid-season is exactly the rebalancing that document
   * forbids.
   */
  routes.get<{ Params: TerritorySeasonParams }>(
    '/v1/staff/territory/seasons/:seasonId/divisions',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritorySeasonParamsSchema,
        response: {
          200: DivisionSizeListResponseSchema,
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

      const sizes = await database.query<{ division: string; enrolled_count: string }>(
        `SELECT division, count(*)::text AS enrolled_count
         FROM territory_enrollments
         WHERE season_id = $1 AND withdrawn_at IS NULL
         GROUP BY division
         ORDER BY division
         LIMIT 100`,
        [request.params.seasonId]
      );
      return {
        data: sizes.rows.map((row) => ({
          division: row.division,
          enrolledCount: Number(row.enrolled_count),
          advice: divisionSizeAdvice(Number(row.enrolled_count))
        }))
      };
    }
  );
};
