import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  TerritoryEventCreateRequestSchema,
  TerritoryEventListResponseSchema,
  TerritoryConcentrationReportSchema,
  TerritoryLeaderboardQuerySchema,
  TerritoryLeaderboardResponseSchema,
  TerritoryTradeFlagListResponseSchema,
  TerritoryTradeReviewRequestSchema,
  type Coordinate,
  type TerritoryConcentrationReport,
  type TerritoryEvent,
  type TerritoryEventCreateRequest,
  type TerritoryEventListResponse,
  type TerritoryLeaderboardEntry,
  type TerritoryLeaderboardMetric,
  type TerritoryLeaderboardQuery,
  type TerritoryLeaderboardResponse,
  type TerritoryLeaderboardScope,
  type TerritoryTradeFlagListResponse,
  type TerritoryTradeReviewRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  CLAIM_TRADING_REVIEW_NOTE,
  canModerate,
  canOperateCompetitions,
  divisionConcentration
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
      const club = scope === 'club';

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
           AND account.deleted_at IS NULL
           AND ${notSharingSuspended('claim.account_id')}
           AND ${NOT_TRADED_GROUND}
           ${club ? 'AND claim.club_id IS NOT NULL' : ''}
         GROUP BY ${club ? 'claim.club_id' : 'claim.account_id'}
         ORDER BY ${ORDER_BY[metric]}
         LIMIT $1`,
        [BOARD_LIMIT]
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
             AND ${NOT_TRADED_GROUND}
           GROUP BY claim.account_id`,
          [accountId]
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
        entries,
        ...(own ? { self: own } : {}),
        note: LEADERBOARD_NOTE[metric]
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
