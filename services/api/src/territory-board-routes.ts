import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  TerritoryEventCreateRequestSchema,
  TerritoryEventListResponseSchema,
  TerritoryConcentrationReportSchema,
  TerritoryHallOfFameQuerySchema,
  TerritoryHallOfFameResponseSchema,
  TerritoryLeaderboardQuerySchema,
  TerritoryLeaderboardResponseSchema,
  TerritoryClaimSeasonListResponseSchema,
  TerritoryClaimSeasonRecapResponseSchema,
  TerritoryTradeFlagListResponseSchema,
  TerritoryTradeReviewRequestSchema,
  type Coordinate,
  type TerritoryConcentrationReport,
  type TerritoryEvent,
  type TerritoryEventCreateRequest,
  type TerritoryEventListResponse,
  type TerritoryHallOfFameEntry,
  type TerritoryHallOfFameQuery,
  type TerritoryHallOfFameResponse,
  type TerritoryLeaderboardEntry,
  type TerritoryLeaderboardMetric,
  type TerritoryLeaderboardPeriod,
  type TerritoryLeaderboardQuery,
  type TerritoryLeaderboardResponse,
  type TerritoryLeaderboardScope,
  type TerritoryClaimSeasonListResponse,
  type TerritoryClaimSeasonRecapResponse,
  type TerritoryTradeFlagListResponse,
  type TerritoryTradeReviewRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  CLAIM_TRADING_REVIEW_NOTE,
  canModerate,
  canOperateCompetitions,
  divisionConcentration,
  rankWeekStart,
  seasonEndsAt,
  seasonMonthFor
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { notSharingSuspended } from './sanction-guard.js';

/**
 * Territory leaderboards and map events (Phase 5, milestone 5.6).
 *
 * Both name people, as the rest of this mechanic does. Neither publishes
 * anything the map does not already show: a standing is a count and an area,
 * and anybody who can pan the map can derive both. No pace, no route beyond the
 * boundaries already drawn, no timestamps beyond a capture date.
 *
 * Suspended accounts appear on neither, the same as everywhere else.
 */
export interface TerritoryBoardRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const BOARD_LIMIT = 100;

/**
 * Ground a human has confirmed was being passed back and forth is left off the
 * boards (milestone 5.8).
 *
 * This is the whole consequence, and it is the smallest one that works: passing
 * ground between two accounts is only worth doing because it moves a board
 * position, so the position goes and nothing else does. The claims stay on the
 * map, both accounts are untouched, and dismissing the flag puts the ground
 * straight back. An **unreviewed** flag changes nothing at all — it is a
 * question, and two friends who race each other every week ask it too.
 */
const NOT_TRADED_GROUND = `NOT EXISTS (
     SELECT 1 FROM territory_trade_flags flag
     WHERE flag.lineage_id = claim.lineage_id AND flag.review_outcome = 'upheld')`;

/**
 * What each board counts, said on the board.
 *
 * `defended` exists so the game rewards holding ground and not only taking it;
 * without it every board is a distance board wearing a different hat.
 */
export const LEADERBOARD_NOTE: Readonly<Record<TerritoryLeaderboardMetric, string>> = {
  area: 'Total ground currently held. Ground you lose stops counting the moment somebody takes it.',
  claims: 'How many separate territories are currently held.',
  defended: 'Ground held through at least one challenge — kept, not just taken.',
  fastest: 'The quickest loop anybody is currently holding ground with.'
};

const TradeFlagParamsSchema = {
  type: 'object',
  required: ['flagId'],
  additionalProperties: false,
  properties: { flagId: { type: 'string', format: 'uuid' } }
} as const;

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

const avatarKeyFrom = (cosmetic: unknown): string => {
  const key = (cosmetic as { avatarKey?: unknown } | null)?.avatarKey;
  return typeof key === 'string' && key.length > 0 && key.length <= 64 ? key : 'default';
};

/** Guarded: an unreadable geometry drops that row rather than failing the read. */
const parseGeometry = <T>(value: unknown): T | undefined => {
  if (typeof value !== 'string') return (value as T) ?? undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const ringFromGeoJson = (value: unknown): Coordinate[] => {
  const parsed = parseGeometry<{ coordinates?: number[][][] }>(value);
  const ring = parsed?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  return ring
    .slice(0, -1)
    .flatMap((pair) =>
      typeof pair[0] === 'number' && typeof pair[1] === 'number'
        ? [[pair[0], pair[1]] as Coordinate]
        : []
    );
};

/** Ordering column per metric. Written here rather than interpolated from input. */
const ORDER_BY: Readonly<Record<TerritoryLeaderboardMetric, string>> = {
  area: 'total_area DESC',
  claims: 'claim_count DESC',
  defended: 'defended_count DESC',
  // A board of the quickest loops wants the smallest number first.
  fastest: 'fastest_seconds ASC NULLS LAST'
};

interface BoardRow {
  key: string;
  display_name: string | null;
  cosmetic: unknown;
  club_name: string | null;
  total_area: string;
  claim_count: string;
  defended_count: string;
  fastest_seconds: number | null;
}

/** A place board is city, country, or the whole world. */
const PLACE_SCOPES = new Set<TerritoryLeaderboardScope>(['city', 'country', 'global']);

/**
 * What the reader's own claims say about where they run.
 *
 * `screens.md` 1.2 wants the My City tab pre-selected without asking anybody to
 * pick a city from a list of every city on earth, so it is inferred from their
 * own held ground — the most ground first, because somebody who has one claim
 * in Pune and nine in Mumbai is a Mumbai runner.
 *
 * Nothing is stored. This is derived per request from claims that are already
 * on a public map, so it adds no new record of where anybody lives.
 */
const inferPlace = async (
  database: Database,
  accountId: string,
  scope: 'city' | 'country',
  seasonMonth: string
): Promise<string | undefined> => {
  const column = scope === 'city' ? 'city_tag' : 'country_tag';
  const found = await database.query<{ scope_key: string }>(
    `SELECT ${column} AS scope_key
     FROM territory_claims
     WHERE account_id = $1 AND ${column} IS NOT NULL AND season_month = $2
     GROUP BY ${column}
     ORDER BY sum(area_sqm) DESC
     LIMIT 1`,
    [accountId, seasonMonth]
  );
  if (found.rows[0]) return found.rows[0].scope_key;
  // Fall back to any season: a runner between seasons still has a city.
  const ever = await database.query<{ scope_key: string }>(
    `SELECT ${column} AS scope_key FROM territory_claims
     WHERE account_id = $1 AND ${column} IS NOT NULL
     GROUP BY ${column} ORDER BY sum(area_sqm) DESC LIMIT 1`,
    [accountId]
  );
  return ever.rows[0]?.scope_key;
};

/** The SQL filter for a place scope, and the value it binds. */
const placeFilterFor = (
  scope: TerritoryLeaderboardScope,
  scopeKey: string | undefined,
  parameterIndex: number
): { clause: string; value?: string } => {
  if (scope === 'city' && scopeKey)
    return { clause: `AND claim.city_tag = $${parameterIndex}`, value: scopeKey };
  if (scope === 'country' && scopeKey)
    return { clause: `AND claim.country_tag = $${parameterIndex}`, value: scopeKey };
  return { clause: '' };
};

/** What each all-time record counts, said next to it. */
const HALL_OF_FAME_NOTE: Readonly<Record<'largest_holding' | 'largest_claim', string>> = {
  largest_holding: 'The most ground one runner has ever held at once here.',
  largest_claim: 'The single biggest loop anybody has ever kept here.'
};

/**
 * When the season being played resets: 00:01 IST on the 1st of next month.
 *
 * Sent so the app's countdown badge needs no timezone rules of its own — the
 * server owns when a season ends, as it owns everything else about scoring.
 */
// The instant itself lives in the domain (`seasonEndsAt`), because the
// three-day warning job has to agree with what this route publishes.
const seasonEndsAtIso = (now: Date): string => seasonEndsAt(now).toISOString();

export const registerTerritoryBoardRoutes = ({
  routes,
  database,
  authSecret
}: TerritoryBoardRouteDeps): void => {
  /**
   * The territory leaderboard, individual or club.
   *
   * Only ground currently held counts. A board that counted ground somebody
   * used to hold would reward having once been fast, and this mechanic is about
   * keeping what you take.
   */
  routes.get<{ Querystring: TerritoryLeaderboardQuery }>(
    '/v1/territory/leaderboard',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: TerritoryLeaderboardQuerySchema,
        response: {
          200: TerritoryLeaderboardResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const scope: TerritoryLeaderboardScope = request.query.scope ?? 'individual';
      const metric: TerritoryLeaderboardMetric = request.query.metric ?? 'area';
      const period: TerritoryLeaderboardPeriod = request.query.period ?? 'season';
      const club = scope === 'club';
      const currentSeason = seasonMonthFor(new Date());
      const seasonMonth = request.query.seasonMonth ?? currentSeason;

      // A place board needs a place. Asked for, or inferred from the reader's
      // own ground, which is what the app's My City tab wants.
      let scopeKey: string | undefined;
      let scopeInferred = false;
      if (scope === 'city' || scope === 'country') {
        scopeKey = request.query.scopeKey;
        if (!scopeKey) {
          scopeKey = await inferPlace(database, accountId, scope, seasonMonth);
          scopeInferred = true;
        }
        if (!scopeKey) {
          // They hold no tagged ground, so there is no city to show them. Said
          // as its own reason rather than as an empty board, which would read
          // as "nobody here" instead of "we do not know where you run".
          const empty: TerritoryLeaderboardResponse = {
            scope,
            metric,
            period,
            seasonMonth,
            entries: [],
            unavailableReason: 'no_place_yet',
            note: LEADERBOARD_NOTE[metric]
          };
          return empty;
        }
      }

      // A finished season, or a week, is read from the frozen snapshot rather
      // than recomputed: by then the claims are archived and the ground belongs
      // to somebody else, so a live query would answer a different question.
      const fromSnapshot = period === 'week' || seasonMonth !== currentSeason;
      if (fromSnapshot && PLACE_SCOPES.has(scope)) {
        const snapshotScope = scope === 'global' ? 'global' : scope;
        const snapshotKey = scope === 'global' ? 'GLOBAL' : scopeKey!;
        const values: unknown[] =
          period === 'week'
            ? [seasonMonth, snapshotScope, snapshotKey, rankWeekStart(new Date()), BOARD_LIMIT]
            : [seasonMonth, snapshotScope, snapshotKey, BOARD_LIMIT];
        const rows = await database.query<{
          account_id: string;
          display_name: string | null;
          cosmetic: unknown;
          total_area_sqm: number;
          claim_count: number;
          rank: number;
        }>(
          `SELECT snapshot.account_id, profile.display_name, profile.cosmetic,
             snapshot.total_area_sqm, snapshot.claim_count, snapshot.rank
           FROM territory_claim_season_snapshots snapshot
           LEFT JOIN profiles profile ON profile.account_id = snapshot.account_id
           WHERE snapshot.season_month = $1 AND snapshot.scope = $2 AND snapshot.scope_key = $3
             AND snapshot.kind = ${period === 'week' ? "'weekly' AND snapshot.week_start = $4::date" : "'final'"}
           ORDER BY snapshot.rank
           LIMIT ${period === 'week' ? '$5' : '$4'}`,
          values
        );

        const snapshotEntries: TerritoryLeaderboardEntry[] = rows.rows.map((row) => ({
          rank: Number(row.rank),
          owner: {
            id: row.account_id,
            displayName: row.display_name ?? 'RunSphere member',
            avatarKey: avatarKeyFrom(row.cosmetic),
            isSelf: row.account_id === accountId
          },
          totalAreaSqm: Number(row.total_area_sqm),
          claimCount: Number(row.claim_count),
          // A snapshot records ground and rank, not how it was won. Sending a
          // zero would read as "defended nothing"; it means "not recorded".
          defendedCount: 0,
          isSelf: row.account_id === accountId
        }));

        const response: TerritoryLeaderboardResponse = {
          scope,
          metric: 'area',
          period,
          seasonMonth,
          ...(scope !== 'global' && scopeKey ? { scopeKey } : {}),
          ...(scopeInferred ? { scopeInferred: true } : {}),
          entries: snapshotEntries,
          note:
            period === 'week'
              ? 'Ground held when the week was recorded, on Monday. It does not move until next Monday.'
              : `Where everybody finished in ${seasonMonth}. This season is over and its ground has been released.`
        };
        return response;
      }

      const place = placeFilterFor(scope, scopeKey, 3);
      const values: unknown[] = [BOARD_LIMIT, seasonMonth];
      if (place.value) values.push(place.value);

      // `capture_count > 1` is ground taken off somebody: the holder won a
      // challenge for it, which is what "defended" means here.
      const rows = await database.query<BoardRow>(
        `SELECT ${club ? 'claim.club_id::text' : 'claim.account_id::text'} AS key,
           ${club ? 'NULL::text' : 'max(profile.display_name)'} AS display_name,
           ${club ? 'NULL::jsonb' : '(array_agg(profile.cosmetic))[1]'} AS cosmetic,
           ${club ? 'max(club.name)' : 'NULL::text'} AS club_name,
           coalesce(sum(claim.area_sqm), 0)::text AS total_area,
           count(*)::text AS claim_count,
           count(*) FILTER (WHERE claim.capture_count > 1)::text AS defended_count,
           min(claim.duration_seconds) AS fastest_seconds
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN clubs club ON club.id = claim.club_id
         WHERE claim.released_at IS NULL
           AND claim.season_month = $2
           AND account.deleted_at IS NULL
           AND ${notSharingSuspended('claim.account_id')}
           AND ${NOT_TRADED_GROUND}
           ${club ? 'AND claim.club_id IS NOT NULL' : ''}
           ${place.clause}
         GROUP BY ${club ? 'claim.club_id' : 'claim.account_id'}
         ORDER BY ${ORDER_BY[metric]}
         LIMIT $1`,
        values
      );

      const entries: TerritoryLeaderboardEntry[] = rows.rows.map((row, index) => ({
        rank: index + 1,
        ...(club
          ? { club: { id: row.key, name: row.club_name ?? 'A club' } }
          : {
              owner: {
                id: row.key,
                displayName: row.display_name ?? 'RunSphere member',
                avatarKey: avatarKeyFrom(row.cosmetic),
                isSelf: row.key === accountId
              }
            }),
        totalAreaSqm: Number(row.total_area),
        claimCount: Number(row.claim_count),
        defendedCount: Number(row.defended_count),
        ...(row.fastest_seconds ? { fastestSeconds: Number(row.fastest_seconds) } : {}),
        isSelf: !club && row.key === accountId
      }));

      // A board somebody cannot find themselves on tells them nothing, so a
      // reader outside the page gets their own row fetched separately. Club
      // boards skip it: a club standing is not one person's row.
      let own: TerritoryLeaderboardEntry | undefined;
      if (!club && !entries.some((entry) => entry.isSelf)) {
        const selfPlace = placeFilterFor(scope, scopeKey, 3);
        const selfValues: unknown[] = [accountId, seasonMonth];
        if (selfPlace.value) selfValues.push(selfPlace.value);
        const mine = await database.query<BoardRow>(
          `SELECT claim.account_id::text AS key, max(profile.display_name) AS display_name,
             (array_agg(profile.cosmetic))[1] AS cosmetic, NULL::text AS club_name,
             coalesce(sum(claim.area_sqm), 0)::text AS total_area,
             count(*)::text AS claim_count,
             count(*) FILTER (WHERE claim.capture_count > 1)::text AS defended_count,
             min(claim.duration_seconds) AS fastest_seconds
           FROM territory_claims claim
           LEFT JOIN profiles profile ON profile.account_id = claim.account_id
           WHERE claim.released_at IS NULL AND claim.account_id = $1
             AND claim.season_month = $2
             AND ${NOT_TRADED_GROUND}
             ${selfPlace.clause}
           GROUP BY claim.account_id`,
          selfValues
        );
        const row = mine.rows[0];
        if (row) {
          own = {
            // Beyond the page, so the exact position is not known from here.
            rank: BOARD_LIMIT + 1,
            owner: {
              id: row.key,
              displayName: row.display_name ?? 'RunSphere member',
              avatarKey: avatarKeyFrom(row.cosmetic),
              isSelf: true
            },
            totalAreaSqm: Number(row.total_area),
            claimCount: Number(row.claim_count),
            defendedCount: Number(row.defended_count),
            ...(row.fastest_seconds ? { fastestSeconds: Number(row.fastest_seconds) } : {}),
            isSelf: true
          };
        }
      }

      const response: TerritoryLeaderboardResponse = {
        scope,
        metric,
        period,
        seasonMonth,
        ...((scope === 'city' || scope === 'country') && scopeKey ? { scopeKey } : {}),
        ...(scopeInferred ? { scopeInferred: true } : {}),
        entries,
        ...(own ? { self: own } : {}),
        note: LEADERBOARD_NOTE[metric]
      };
      return response;
    }
  );

  /**
   * The seasons there have been, and when this one ends.
   *
   * A season picker needs a list, and a countdown badge needs a deadline. The
   * deadline is computed here rather than in the app so nothing client-side has
   * to know that a Turf month ends at 00:01 Asia/Kolkata.
   */
  routes.get(
    '/v1/territory/leaderboard/seasons',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryClaimSeasonListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const now = new Date();
      const current = seasonMonthFor(now);
      const seasons = await database.query<{
        season_month: string;
        started_at: Date;
        ended_at: Date | null;
        claims_archived: number;
      }>(
        `SELECT season_month, started_at, ended_at, claims_archived
         FROM territory_claim_seasons ORDER BY season_month DESC LIMIT 60`
      );

      const response: TerritoryClaimSeasonListResponse = {
        data: seasons.rows.map((row) => ({
          seasonMonth: row.season_month,
          startedAt: row.started_at.toISOString(),
          ...(row.ended_at ? { endedAt: row.ended_at.toISOString() } : {}),
          claimsArchived: Number(row.claims_archived),
          isCurrent: row.season_month === current
        })),
        currentSeasonMonth: current,
        currentSeasonEndsAt: seasonEndsAtIso(now)
      };
      return response;
    }
  );

  /**
   * All-time records for a place.
   *
   * Kept per place because a worldwide record is unreachable for almost
   * everybody, and a record nobody can beat is a fact rather than a game. A
   * Mumbai record is something a Mumbai runner can go and take.
   *
   * The holder is display identity, which every board and the map already
   * publish (ADR-0011). `displayName` is stored on the record rather than
   * joined, so a record set by an account that has since been erased still
   * reads as a sentence — the run happened either way.
   */
  routes.get<{ Querystring: TerritoryHallOfFameQuery }>(
    '/v1/territory/leaderboard/hall-of-fame',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: TerritoryHallOfFameQuerySchema,
        response: {
          200: TerritoryHallOfFameResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const scope = request.query.scope ?? 'city';
      let scopeKey = request.query.scopeKey;
      if (scope !== 'global' && !scopeKey) {
        scopeKey = await inferPlace(database, accountId, scope, seasonMonthFor(new Date()));
        if (!scopeKey) {
          const empty: TerritoryHallOfFameResponse = {
            scope,
            entries: [],
            unavailableReason: 'no_place_yet',
            note: 'Claim some ground and the records for where you run will show up here.'
          };
          return empty;
        }
      }

      const rows = await database.query<{
        record_type: string;
        value_sqm: number;
        display_name: string;
        account_id: string | null;
        cosmetic: unknown;
        season_month: string;
        achieved_at: Date;
      }>(
        `SELECT record.record_type, record.value_sqm, record.display_name,
           record.account_id, profile.cosmetic, record.season_month, record.achieved_at
         FROM territory_claim_hall_of_fame record
         LEFT JOIN profiles profile ON profile.account_id = record.account_id
         WHERE record.scope = $1 AND record.scope_key = $2
         ORDER BY record.record_type`,
        [scope, scope === 'global' ? 'GLOBAL' : scopeKey]
      );

      const entries: TerritoryHallOfFameEntry[] = rows.rows.flatMap((row) => {
        const recordType = row.record_type;
        if (recordType !== 'largest_holding' && recordType !== 'largest_claim') return [];
        return [
          {
            recordType,
            valueSqm: Number(row.value_sqm),
            displayName: row.display_name,
            ...(row.account_id
              ? {
                  owner: {
                    id: row.account_id,
                    displayName: row.display_name,
                    avatarKey: avatarKeyFrom(row.cosmetic),
                    isSelf: row.account_id === accountId
                  }
                }
              : {}),
            seasonMonth: row.season_month,
            achievedAt: row.achieved_at.toISOString(),
            note: HALL_OF_FAME_NOTE[recordType]
          }
        ];
      });

      const response: TerritoryHallOfFameResponse = {
        scope,
        ...(scope !== 'global' && scopeKey ? { scopeKey } : {}),
        entries,
        note:
          entries.length === 0
            ? 'No records here yet. The first runner to hold ground through a season sets them.'
            : 'All-time records. Beating one replaces it.'
      };
      return response;
    }
  );

  /**
   * The reader's own recap of the last finished season (`screens.md` 1.5).
   *
   * Read from the final snapshot, which is the only place it survives: by now
   * the claims are archived and their ground belongs to whoever took it in the
   * new month.
   *
   * Absent with a reason rather than empty, because the app shows this as a
   * full-screen card once and a card that says "you finished nowhere with no
   * ground" is worse than no card.
   */
  routes.get(
    '/v1/territory/leaderboard/recap',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryClaimSeasonRecapResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const finished = await database.query<{ season_month: string }>(
        `SELECT season_month FROM territory_claim_seasons
         WHERE ended_at IS NOT NULL ORDER BY season_month DESC LIMIT 1`
      );
      const seasonMonth = finished.rows[0]?.season_month;
      if (!seasonMonth) {
        const none: TerritoryClaimSeasonRecapResponse = { unavailableReason: 'no_finished_season' };
        return none;
      }

      // The city row where they have one, because a city rank is the fact worth
      // showing; the global row otherwise.
      const mine = await database.query<{
        scope: string;
        scope_key: string;
        rank: number;
        total_area_sqm: number;
        peak_area_sqm: number;
        claim_count: number;
        longest_held_days: number;
      }>(
        `SELECT scope, scope_key, rank, total_area_sqm, peak_area_sqm, claim_count,
           longest_held_days
         FROM territory_claim_season_snapshots
         WHERE account_id = $1 AND season_month = $2 AND kind = 'final'
         ORDER BY CASE scope WHEN 'city' THEN 0 WHEN 'country' THEN 1 ELSE 2 END
         LIMIT 1`,
        [accountId, seasonMonth]
      );
      const row = mine.rows[0];
      if (!row) {
        const none: TerritoryClaimSeasonRecapResponse = { unavailableReason: 'held_nothing' };
        return none;
      }

      const records = await database.query<{
        record_type: string;
        value_sqm: number;
        display_name: string;
        season_month: string;
        achieved_at: Date;
      }>(
        `SELECT record_type, value_sqm, display_name, season_month, achieved_at
         FROM territory_claim_hall_of_fame
         WHERE season_month = $1 AND scope = $2 AND scope_key = $3
         ORDER BY record_type`,
        [seasonMonth, row.scope, row.scope_key]
      );

      const response: TerritoryClaimSeasonRecapResponse = {
        recap: {
          seasonMonth,
          rank: Number(row.rank),
          ...(row.scope === 'city' ? { cityTag: row.scope_key } : {}),
          peakAreaSqm: Number(row.peak_area_sqm),
          finalAreaSqm: Number(row.total_area_sqm),
          claimCount: Number(row.claim_count),
          longestHeldDays: Number(row.longest_held_days),
          records: records.rows.flatMap((record) => {
            const recordType = record.record_type;
            if (recordType !== 'largest_holding' && recordType !== 'largest_claim') return [];
            return [
              {
                recordType,
                valueSqm: Number(record.value_sqm),
                displayName: record.display_name,
                seasonMonth: record.season_month,
                achievedAt: record.achieved_at.toISOString(),
                note: HALL_OF_FAME_NOTE[recordType]
              }
            ];
          })
        }
      };
      return response;
    }
  );

  /**
   * Map events covering a viewport.
   *
   * An event is an area and a window; a claim counts for it when its centroid
   * falls inside. Rewards are cosmetic only, so an event changes what a run is
   * *for* without changing what it is worth.
   */
  routes.get(
    '/v1/territory/events',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryEventListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const events = await database.query<{
        id: string;
        title: string;
        description: string;
        starts_at: Date;
        ends_at: Date;
        boundary: unknown;
        centroid: unknown;
        reward: string;
        status: TerritoryEvent['status'];
        held: string;
        mine: string;
      }>(
        `SELECT event.id, event.title, event.description, event.starts_at, event.ends_at,
           ST_AsGeoJSON(event.boundary) AS boundary,
           ST_AsGeoJSON(ST_Centroid(event.boundary)) AS centroid,
           event.reward, event.status,
           (SELECT count(*) FROM territory_claims claim
             WHERE claim.released_at IS NULL
               AND ST_Contains(event.boundary, claim.centroid))::text AS held,
           (SELECT count(*) FROM territory_claims claim
             WHERE claim.released_at IS NULL AND claim.account_id = $1
               AND ST_Contains(event.boundary, claim.centroid))::text AS mine
         FROM territory_events event
         WHERE event.status IN ('announced', 'live')
         ORDER BY event.starts_at
         LIMIT 50`,
        [accountId]
      );

      const response: TerritoryEventListResponse = {
        data: events.rows.flatMap((row) => {
          const boundary = ringFromGeoJson(row.boundary);
          const centre = parseGeometry<{ coordinates?: number[] }>(row.centroid)?.coordinates ?? [];
          if (boundary.length < 3 || centre.length < 2) return [];
          return [
            {
              id: row.id,
              title: row.title,
              description: row.description,
              startsAt: row.starts_at.toISOString(),
              endsAt: row.ends_at.toISOString(),
              boundary,
              centroid: [centre[0]!, centre[1]!] as Coordinate,
              reward: row.reward,
              status: row.status,
              heldClaimCount: Number(row.held),
              selfClaimCount: Number(row.mine)
            }
          ];
        })
      };
      return response;
    }
  );

  /**
   * How concentrated territory holding is (milestone 5.8).
   *
   * `product.md` sets this guardrail per division and this mechanic has no
   * divisions, so it is measured over everybody currently holding ground and
   * the response says so. A per-city number is the one that would mean
   * something, and it needs a concept of a city the data model does not have —
   * naming that here beats publishing a number whose scope nobody can see.
   *
   * Reporting only. Nothing in the product acts on a breach: `product.md` says
   * pause awards analysis and investigate, and both are things people do.
   */
  routes.get(
    '/v1/staff/territory/concentration',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryConcentrationReportSchema,
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
        return reply.code(403).send({ message: 'This needs a season operator role' });

      const holders = await database.query<{ total_area: string }>(
        `SELECT coalesce(sum(area_sqm), 0)::text AS total_area
         FROM territory_claims claim
         WHERE claim.released_at IS NULL
         GROUP BY claim.account_id
         ORDER BY sum(area_sqm) DESC
         LIMIT 10000`
      );
      const concentration = divisionConcentration(
        holders.rows.map((row) => Number(row.total_area))
      );

      const report: TerritoryConcentrationReport = {
        holders: concentration.participants,
        totalAreaSqm: concentration.totalPoints,
        topDecileShare: concentration.topDecileShare,
        topHolderShare: concentration.topParticipantShare,
        applicable: concentration.applicable,
        breached: concentration.breached,
        scopeNote:
          'Measured over everybody currently holding ground, because this mechanic has no divisions. A per-city figure would be more meaningful and needs a concept of a city this data model does not have.'
      };
      return report;
    }
  );

  /**
   * Ground two accounts keep passing back and forth (milestone 5.6).
   *
   * A row here is a question. The same pattern is produced by collusion and by
   * two friends who race each other every week, and nothing in the data
   * separates them — so a reviewer decides, and the strongest thing they can do
   * is take the ground off the leaderboards.
   */
  routes.get(
    '/v1/staff/territory/trade-flags',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryTradeFlagListResponseSchema,
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
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'This needs a moderator role' });

      const flags = await database.query<{
        id: string;
        lineage_id: string;
        exchanges: number;
        pair_share: string;
        first_at: Date;
        last_at: Date;
        reviewed_at: Date | null;
        review_outcome: 'upheld' | 'dismissed' | null;
      }>(
        `SELECT id, lineage_id, exchanges, pair_share, first_at, last_at, reviewed_at,
           review_outcome
         FROM territory_trade_flags
         ORDER BY reviewed_at NULLS FIRST, last_at DESC
         LIMIT 100`
      );

      const response: TerritoryTradeFlagListResponse = {
        data: flags.rows.map((row) => ({
          id: row.id,
          lineageId: row.lineage_id,
          exchanges: Number(row.exchanges),
          pairShare: Number(row.pair_share),
          firstAt: row.first_at.toISOString(),
          lastAt: row.last_at.toISOString(),
          ...(row.reviewed_at ? { reviewedAt: row.reviewed_at.toISOString() } : {}),
          ...(row.review_outcome ? { reviewOutcome: row.review_outcome } : {})
        })),
        note: CLAIM_TRADING_REVIEW_NOTE
      };
      return response;
    }
  );

  /**
   * Decide one flag.
   *
   * `upheld` takes that ground off the leaderboards and does nothing else — no
   * account is touched, no claim is removed, no history is rewritten.
   * `dismissed` puts it straight back. Both are reversible, because the
   * underlying judgement is one a person could reasonably get wrong.
   */
  routes.post<{ Params: { flagId: string }; Body: TerritoryTradeReviewRequest }>(
    '/v1/staff/territory/trade-flags/:flagId/review',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TradeFlagParamsSchema,
        body: TerritoryTradeReviewRequestSchema,
        response: {
          200: TerritoryTradeFlagListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canModerate(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'This needs a moderator role' });

      const updated = await database.query<{
        id: string;
        lineage_id: string;
        exchanges: number;
        pair_share: string;
        first_at: Date;
        last_at: Date;
        reviewed_at: Date;
        review_outcome: 'upheld' | 'dismissed';
      }>(
        `UPDATE territory_trade_flags
         SET reviewed_at = now(), reviewed_by_account_id = $2, review_outcome = $3,
           review_note = $4
         WHERE id = $1
         RETURNING id, lineage_id, exchanges, pair_share, first_at, last_at, reviewed_at,
           review_outcome`,
        [request.params.flagId, accountId, request.body.outcome, request.body.note.trim()]
      );
      const row = updated.rows[0];
      if (!row) return reply.code(404).send({ message: 'That flag no longer exists' });

      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'territory.trade_flag_reviewed', 'territory_trade_flag', 1)`,
        [accountId]
      );

      const response: TerritoryTradeFlagListResponse = {
        data: [
          {
            id: row.id,
            lineageId: row.lineage_id,
            exchanges: Number(row.exchanges),
            pairShare: Number(row.pair_share),
            firstAt: row.first_at.toISOString(),
            lastAt: row.last_at.toISOString(),
            reviewedAt: row.reviewed_at.toISOString(),
            reviewOutcome: row.review_outcome
          }
        ],
        note: CLAIM_TRADING_REVIEW_NOTE
      };
      return response;
    }
  );

  /** Announce a map event. The same `season_operator` role that runs seasons. */
  routes.post<{ Body: TerritoryEventCreateRequest }>(
    '/v1/staff/territory/events',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        body: TerritoryEventCreateRequestSchema,
        response: {
          201: TerritoryEventListResponseSchema,
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
        return reply.code(403).send({ message: 'An event needs a season operator role' });

      if (Date.parse(request.body.endsAt) <= Date.parse(request.body.startsAt))
        return reply.code(422).send({ message: 'An event must end after it starts' });

      const ring = [...request.body.boundary, request.body.boundary[0]!];
      const created = await database.query<{ id: string }>(
        `INSERT INTO territory_events (title, description, starts_at, ends_at, boundary,
           reward, created_by_account_id)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6, $7)
         RETURNING id`,
        [
          request.body.title.trim(),
          request.body.description.trim(),
          request.body.startsAt,
          request.body.endsAt,
          JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
          request.body.reward.trim(),
          accountId
        ]
      );
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'territory.event_announced', 'territory_event', 1)`,
        [accountId]
      );

      const response: TerritoryEventListResponse = {
        data: [
          {
            id: created.rows[0]!.id,
            title: request.body.title.trim(),
            description: request.body.description.trim(),
            startsAt: request.body.startsAt,
            endsAt: request.body.endsAt,
            boundary: request.body.boundary,
            centroid: request.body.boundary[0]!,
            reward: request.body.reward.trim(),
            status: 'announced',
            heldClaimCount: 0,
            selfClaimCount: 0
          }
        ]
      };
      return reply.code(201).send(response);
    }
  );
};
