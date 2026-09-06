import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  TerritoryClaimActivityResponseSchema,
  TerritoryClaimBoundsSchema,
  TerritoryClaimHistoryResponseSchema,
  TerritoryClaimMapResponseSchema,
  TerritoryClaimRequestSchema,
  TerritoryClaimResultSchema,
  TerritoryClaimSummarySchema,
  TerritoryClusterListResponseSchema,
  TerritoryRecommendationResponseSchema,
  type Coordinate,
  type TerritoryClaim,
  type TerritoryClaimActivityResponse,
  type TerritoryClaimBounds,
  type TerritoryClaimMapResponse,
  type TerritoryClaimRequest,
  type TerritoryClaimResult,
  type TerritoryClaimHistoryResponse,
  type TerritoryClaimSummary,
  type TerritoryClusterListResponse,
  type TerritoryRecommendationResponse
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  CLAIM_REFUSAL_MESSAGE,
  DEFAULT_CLAIM_RULE,
  RECOMMENDATION_NOTE,
  RUN_INTEGRITY_MESSAGE,
  abilityFrom,
  assessRunIntegrity,
  canonicaliseRing,
  detectClaimTrading,
  claimOutcome,
  detectLoopClaim,
  haversineMetres,
  recommendCaptures,
  type CandidateTerritory,
  type ClaimPoint,
  type ClaimRing,
  type HeldClaim
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { notSharingSuspended, requireSharingAllowed } from './sanction-guard.js';

/**
 * Enclosure territory claims (Phase 5, milestone 5.1; ADR-0011).
 *
 * Run a closed loop and you hold what it encloses, until somebody runs the same
 * ground faster. These routes are the map, the claim, and the record of who took
 * what from whom.
 *
 * **What these publish, deliberately** (ADR-0011): the holder's display name and
 * avatar, the loop they ran, and the time they ran it in. That is the whole
 * point of the mechanic and the opposite of what the H3 cell map does.
 *
 * What they still refuse to publish: anything that is not display identity. No
 * email, no contact details, no activity detail beyond the loop itself, and
 * nothing at all from an account under a sharing suspension.
 */
export interface TerritoryClaimRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

/**
 * Said wherever the map is shown. Somebody looking at a picture of their own
 * neighbourhood with names on it should not have to infer what it records.
 */
export const TERRITORY_CLAIM_MAP_NOTE =
  'Territory shows the loops people ran and who holds them. Anyone who can see a claim can see its outline, the holder’s name, and their time. Run a closed loop to claim ground; run someone else’s ground faster to take it.';

/** One page of the map. Beyond this the app is told to zoom in. */
const MAP_LIMIT = 400;

const TerritoryClaimParamsSchema = {
  type: 'object',
  required: ['claimId'],
  additionalProperties: false,
  properties: { claimId: { type: 'string', format: 'uuid' } }
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

interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}
interface GeoJsonPoint {
  type: 'Point';
  coordinates: number[];
}

const asJson = <T>(value: unknown): T | undefined => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return (value as T) ?? undefined;
};

/**
 * PostGIS gives back a closed ring — first point repeated last. The contract
 * carries the ring open, because every renderer closes it again and shipping the
 * duplicate would put one more point on the wire for every claim on screen.
 */
const ringFromGeoJson = (value: unknown): Coordinate[] => {
  const polygon = asJson<GeoJsonPolygon>(value);
  const ring = polygon?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const open = ring.slice(0, -1);
  return open.flatMap((pair) =>
    Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number'
      ? [[pair[0], pair[1]] as Coordinate]
      : []
  );
};

const pointFromGeoJson = (value: unknown): Coordinate | undefined => {
  const point = asJson<GeoJsonPoint>(value);
  const pair = point?.coordinates;
  return Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number'
    ? [pair[0], pair[1]]
    : undefined;
};

/** A ring for PostGIS: closed, and as GeoJSON so no WKT is assembled by hand. */
const polygonGeoJson = (ring: ClaimRing): string =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [[...ring.map(([lng, lat]) => [lng, lat]), [ring[0]![0], ring[0]![1]]]]
  });

/** Display identity lives in `profiles.cosmetic`, not on the account row. */
const avatarKeyFrom = (cosmetic: unknown): string => {
  const key = (cosmetic as { avatarKey?: unknown } | null)?.avatarKey;
  return typeof key === 'string' && key.length > 0 && key.length <= 64 ? key : 'default';
};

interface ClaimRow {
  id: string;
  account_id: string;
  display_name: string | null;
  cosmetic: unknown;
  boundary: unknown;
  centroid: unknown;
  area_sqm: number;
  distance_metres: number | null;
  duration_seconds: number;
  capture_count: number;
  club_id: string | null;
  club_name: string | null;
  claimed_at: Date;
}

const claimView = (row: ClaimRow, readerId: string): TerritoryClaim | undefined => {
  const boundary = ringFromGeoJson(row.boundary);
  const centroid = pointFromGeoJson(row.centroid);
  if (boundary.length < 3 || !centroid) return undefined;
  return {
    id: row.id,
    owner: {
      id: row.account_id,
      // The same fallbacks every other social read uses: a claim on the map
      // outlives a profile somebody has not filled in.
      displayName: row.display_name ?? 'RunSphere member',
      avatarKey: avatarKeyFrom(row.cosmetic),
      isSelf: row.account_id === readerId
    },
    boundary: boundary.slice(0, 256),
    centroid,
    areaSqm: Number(row.area_sqm),
    // Guarded rather than compared to null: rows written before `032` have no
    // column at all, and `Number(undefined)` is NaN, which no schema will
    // serialise.
    ...(Number.isFinite(Number(row.distance_metres))
      ? { distanceMetres: Number(row.distance_metres) }
      : {}),
    durationSeconds: Number(row.duration_seconds),
    captureCount: Number(row.capture_count ?? 1),
    // Ground that has changed hands more than once is what people are actually
    // fighting over, and the map draws it differently.
    status: row.club_id
      ? 'club_controlled'
      : Number(row.capture_count ?? 1) > 1
        ? 'contested'
        : 'owned',
    ...(row.club_id && row.club_name ? { club: { id: row.club_id, name: row.club_name } } : {}),
    claimedAt: row.claimed_at.toISOString()
  };
};

/** Loop length from the stored boundary, for rows written before `032`. */
const perimeterOf = (boundary: readonly Coordinate[]): number => {
  let total = 0;
  for (let index = 0; index < boundary.length; index += 1) {
    const from = boundary[index]!;
    const to = boundary[(index + 1) % boundary.length]!;
    total += haversineMetres(
      { longitude: from[0], latitude: from[1] },
      { longitude: to[0], latitude: to[1] }
    );
  }
  return total;
};

/**
 * The trace points of one run, from `activity_chunks`.
 *
 * Times are what the whole mechanic turns on, and only the chunks carry them —
 * `activity_derivations.shareable_route` is a geometry with no time dimension.
 * So a claim can only be made while the raw trace is still inside its retention
 * window, exactly as territory scoring is.
 */
const pointsFrom = (payload: unknown): ClaimPoint[] => {
  const chunk = payload as { points?: unknown };
  if (!Array.isArray(chunk.points)) return [];
  return chunk.points.flatMap((value) => {
    const raw = value as { latitude?: unknown; longitude?: unknown; recordedAt?: unknown };
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.recordedAt !== 'string'
    )
      return [];
    const at = new Date(raw.recordedAt);
    return Number.isNaN(at.getTime())
      ? []
      : [{ latitude: raw.latitude, longitude: raw.longitude, at }];
  });
};

export const registerTerritoryClaimRoutes = ({
  routes,
  database,
  authSecret
}: TerritoryClaimRouteDeps): void => {
  /**
   * Every claim held inside the viewport.
   *
   * Claims from accounts under a sharing suspension are left out, the same way
   * every other social read in this product treats them: a suspension pauses
   * being visible to other people, and a name on a map is exactly that.
   */
  routes.get<{ Querystring: TerritoryClaimBounds }>(
    '/v1/territory/claims',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: TerritoryClaimBoundsSchema,
        response: {
          200: TerritoryClaimMapResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const { west, south, east, north } = request.query;
      const found = await database.query<ClaimRow>(
        `SELECT claim.id, claim.account_id, profile.display_name, profile.cosmetic,
           ST_AsGeoJSON(claim.boundary) AS boundary,
           ST_AsGeoJSON(claim.centroid) AS centroid, claim.area_sqm,
           claim.distance_metres, claim.duration_seconds, claim.capture_count,
           claim.club_id, club.name AS club_name, claim.claimed_at
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN clubs club ON club.id = claim.club_id
         WHERE claim.released_at IS NULL
           AND account.deleted_at IS NULL
           AND ${notSharingSuspended('claim.account_id')}
           AND claim.boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         ORDER BY claim.area_sqm DESC
         LIMIT $5`,
        [west, south, east, north, MAP_LIMIT + 1]
      );

      const truncated = found.rows.length > MAP_LIMIT;
      const response: TerritoryClaimMapResponse = {
        claims: found.rows.slice(0, MAP_LIMIT).flatMap((row) => {
          const view = claimView(row, accountId);
          return view ? [view] : [];
        }),
        truncated,
        mapNote: TERRITORY_CLAIM_MAP_NOTE
      };
      return response;
    }
  );

  /**
   * Claim the ground a run enclosed.
   *
   * Most runs are not loops, so a refusal is an ordinary outcome and comes back
   * as a 200 with a reason and the words to show. Only a run that failed to
   * belong to this account, or does not exist, is an error.
   *
   * The whole decision is taken inside one transaction with the contested claims
   * locked: two people finishing the same loop at the same moment must not both
   * be told they took it.
   */
  routes.post<{ Body: TerritoryClaimRequest }>(
    '/v1/territory/claims',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        body: TerritoryClaimRequestSchema,
        response: {
          200: TerritoryClaimResultSchema,
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
      // Claiming puts this account's name on a public map, so it is a
      // publishing act and a sharing suspension stops it.
      if (!(await requireSharingAllowed(database, reply, accountId))) return;

      const owned = await database.query<{ id: string }>(
        `SELECT id FROM activity_submissions
         WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
           AND status = 'derived' AND raw_trace_purged_at IS NULL`,
        [request.body.activityId, accountId]
      );
      if (!owned.rows[0])
        return reply.code(404).send({ message: 'That run is not available to claim from' });

      const chunks = await database.query<{ payload: unknown }>(
        `SELECT payload FROM activity_chunks WHERE activity_id = $1 ORDER BY sequence`,
        [request.body.activityId]
      );
      const points = chunks.rows.flatMap((row) => pointsFrom(row.payload));

      // Ownership is decided by time, so a fabricated time takes real ground
      // off a real person. This is the only thing standing between the two.
      // It refuses a claim and records the run for review; it never punishes.
      const integrity = assessRunIntegrity(points);
      if (integrity.verdict !== 'clean') {
        await database.query(
          `INSERT INTO run_integrity_flags (activity_id, account_id, verdict, findings,
             peak_speed_mps, average_speed_mps, distance_metres, straightness)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (activity_id) DO UPDATE SET verdict = EXCLUDED.verdict,
             findings = EXCLUDED.findings, peak_speed_mps = EXCLUDED.peak_speed_mps,
             average_speed_mps = EXCLUDED.average_speed_mps,
             distance_metres = EXCLUDED.distance_metres,
             straightness = EXCLUDED.straightness, created_at = now()`,
          [
            request.body.activityId,
            accountId,
            integrity.verdict,
            integrity.findings,
            integrity.peakSpeedMps,
            integrity.averageSpeedMps,
            integrity.distanceMetres,
            Math.min(1, Math.max(0, integrity.straightness))
          ]
        );
      }
      if (integrity.verdict === 'rejected') {
        const result: TerritoryClaimResult = {
          claimed: false,
          refusal: 'run_integrity',
          message: RUN_INTEGRITY_MESSAGE[integrity.findings[0] ?? 'impossible_speed'],
          takenOverCount: 0,
          isFirstClaim: false
        };
        return result;
      }

      const detection = detectLoopClaim(points, DEFAULT_CLAIM_RULE);
      if (!('claim' in detection)) {
        const result: TerritoryClaimResult = {
          claimed: false,
          refusal: detection.refusal,
          message: CLAIM_REFUSAL_MESSAGE[detection.refusal],
          takenOverCount: 0,
          isFirstClaim: false
        };
        return result;
      }
      const candidate = detection.claim;
      // Rotated to a vertex chosen by geography before anything is stored: a
      // polygon never showed where somebody started, but the array did, and on
      // a loop run from home the first coordinate is the front door.
      const boundary = canonicaliseRing(candidate.boundary);
      const boundaryJson = polygonGeoJson(boundary);

      // ADR-0002: privacy zones apply before any activity geometry is shared,
      // and a claim boundary is shared activity geometry. A polygon cannot be
      // partly published — removing a segment would not leave a closed ring —
      // so a loop through a protected area is refused rather than trimmed.
      // Only the claimant's own zones apply: a zone protects its owner's route
      // from publication, and this is their route.
      const intrudes = await database.query<{ zone_id: string }>(
        `SELECT zone.id AS zone_id
         FROM privacy_zones zone
         WHERE zone.account_id = $1
           AND ST_DWithin(
             ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography,
             zone.geometry::geography,
             200)
         LIMIT 1`,
        [accountId, boundaryJson]
      );
      if (intrudes.rows[0]) {
        const result: TerritoryClaimResult = {
          claimed: false,
          refusal: 'privacy_zone',
          message: CLAIM_REFUSAL_MESSAGE.privacy_zone,
          takenOverCount: 0,
          isFirstClaim: false
        };
        return result;
      }

      return withTransaction(database, async (client) => {
        // Lock the claims this loop could contest before deciding anything, so
        // two runners finishing together cannot both be told they won.
        const contested = await client.query<{
          id: string;
          account_id: string;
          duration_seconds: number;
          capture_count: number;
          lineage_id: string | null;
          boundary: unknown;
        }>(
          `SELECT claim.id, claim.account_id, claim.duration_seconds, claim.capture_count,
             claim.lineage_id, ST_AsGeoJSON(claim.boundary) AS boundary
           FROM territory_claims claim
           WHERE claim.released_at IS NULL
             AND claim.boundary && ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
           FOR UPDATE`,
          [boundaryJson]
        );

        const held: HeldClaim[] = contested.rows.flatMap((row) => {
          const boundary = ringFromGeoJson(row.boundary);
          return boundary.length >= 3
            ? [{ id: row.id, boundary, durationSeconds: Number(row.duration_seconds) }]
            : [];
        });
        const outcome = claimOutcome(candidate, held, DEFAULT_CLAIM_RULE);
        if ('refusal' in outcome) {
          // A challenge that came up short is the other half of the record: it
          // is what lets a territory say how often it has been *held*, not only
          // how often it changed hands.
          for (const contestedId of outcome.contestedIds) {
            const holder = contested.rows.find((row) => row.id === contestedId);
            if (!holder) continue;
            await client.query(
              `INSERT INTO territory_claim_attempts (lineage_id, defending_claim_id,
                 defending_account_id, challenger_account_id, holder_duration_seconds,
                 challenger_duration_seconds)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                holder.lineage_id ?? holder.id,
                holder.id,
                holder.account_id,
                accountId,
                Number(holder.duration_seconds),
                candidate.durationSeconds
              ]
            );
          }
          const result: TerritoryClaimResult = {
            claimed: false,
            refusal: outcome.refusal,
            message: CLAIM_REFUSAL_MESSAGE[outcome.refusal],
            takenOverCount: 0,
            isFirstClaim: false
          };
          return result;
        }

        // Ground carries its story forward: the lineage of whatever it takes
        // over, the running count of hands it has passed through, and who held
        // it last. A first claim starts its own lineage.
        const superseded = contested.rows.filter((row) => outcome.takenOverIds.includes(row.id));
        const inheritedLineage = superseded[0]?.lineage_id ?? superseded[0]?.id;
        const captureCount =
          superseded.reduce((most, row) => Math.max(most, Number(row.capture_count ?? 1)), 0) + 1;

        // Whether this account has ever claimed before. Read inside the same
        // transaction as the insert so the answer cannot race a second run.
        const prior = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM territory_claims WHERE account_id = $1',
          [accountId]
        );
        const isFirstClaim = Number(prior.rows[0]?.count ?? 0) === 0;

        // The club is read at claim time and stored, so leaving a club later
        // does not rewrite who held ground last month.
        const membership = await client.query<{ club_id: string }>(
          `SELECT club_id FROM club_memberships
           WHERE account_id = $1 AND left_at IS NULL
           ORDER BY joined_at LIMIT 1`,
          [accountId]
        );

        const inserted = await client.query<ClaimRow>(
          `INSERT INTO territory_claims (account_id, activity_id, boundary, centroid,
             area_sqm, distance_metres, duration_seconds, capture_count,
             previous_owner_account_id, club_id, lineage_id)
           VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
             ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11,
             coalesce($12::uuid, gen_random_uuid()))
           RETURNING id, account_id, ST_AsGeoJSON(boundary) AS boundary,
             ST_AsGeoJSON(centroid) AS centroid, area_sqm, distance_metres,
             duration_seconds, capture_count, club_id, claimed_at`,
          [
            accountId,
            request.body.activityId,
            boundaryJson,
            candidate.centroid[0],
            candidate.centroid[1],
            candidate.areaSqm,
            perimeterOf(boundary.map(([lng, lat]) => [lng, lat] as Coordinate)),
            candidate.durationSeconds,
            captureCount,
            superseded[0]?.account_id ?? null,
            membership.rows[0]?.club_id ?? null,
            inheritedLineage ?? null
          ]
        );
        const row = inserted.rows[0];
        if (!row) throw new Error('territory claim insert returned no row');

        for (const taken of outcome.takenOverIds) {
          const previous = contested.rows.find((entry) => entry.id === taken);
          if (!previous) continue;
          await client.query(
            `UPDATE territory_claims SET released_at = now(), released_to_claim_id = $2
             WHERE id = $1 AND released_at IS NULL`,
            [taken, row.id]
          );
          await client.query(
            `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
               taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
               new_duration_seconds)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              taken,
              previous.account_id,
              row.id,
              accountId,
              Number(previous.duration_seconds),
              candidate.durationSeconds
            ]
          );
        }

        // Ground that keeps going back and forth between the same two people is
        // worth a human looking at. Written as a question, never acted on: two
        // friends who race each other every week produce the same pattern, and
        // nothing in the data separates them (`claim-trading.ts`).
        if (outcome.takenOverIds.length > 0 && inheritedLineage) {
          const history = await client.query<{
            taken_from_account_id: string | null;
            taken_by_account_id: string | null;
            created_at: Date;
          }>(
            `SELECT takeover.taken_from_account_id, takeover.taken_by_account_id,
               takeover.created_at
             FROM territory_claim_takeovers takeover
             JOIN territory_claims claim ON claim.id = takeover.taken_by_claim_id
             WHERE claim.lineage_id = $1
             ORDER BY takeover.created_at
             LIMIT 200`,
            [inheritedLineage]
          );
          const events = history.rows.flatMap((event) =>
            event.taken_from_account_id && event.taken_by_account_id
              ? [
                  {
                    lineageId: inheritedLineage,
                    fromAccountId: event.taken_from_account_id,
                    toAccountId: event.taken_by_account_id,
                    at: event.created_at
                  }
                ]
              : []
          );
          for (const finding of detectClaimTrading(events, new Date())) {
            await client.query(
              `INSERT INTO territory_trade_flags (lineage_id, account_a, account_b, exchanges,
                 pair_share, first_at, last_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (lineage_id, account_a, account_b)
               DO UPDATE SET exchanges = EXCLUDED.exchanges, pair_share = EXCLUDED.pair_share,
                 last_at = EXCLUDED.last_at`,
              [
                finding.lineageId,
                finding.accounts[0],
                finding.accounts[1],
                finding.exchanges,
                finding.pairShare.toFixed(3),
                finding.firstAt,
                finding.lastAt
              ]
            );
          }
        }

        const profile = await client.query<{ display_name: string; cosmetic: unknown }>(
          'SELECT display_name, cosmetic FROM profiles WHERE account_id = $1',
          [accountId]
        );
        const view = claimView(
          {
            ...row,
            display_name: profile.rows[0]?.display_name ?? null,
            cosmetic: profile.rows[0]?.cosmetic ?? null,
            club_name: null
          },
          accountId
        );
        const result: TerritoryClaimResult = {
          claimed: true,
          ...(view ? { claim: view } : {}),
          message:
            outcome.takenOverIds.length === 0
              ? 'Ground claimed. Nobody held it before you.'
              : `Ground taken. You beat ${outcome.takenOverIds.length === 1 ? 'the holder' : `${outcome.takenOverIds.length} holders`} on time.`,
          takenOverCount: outcome.takenOverIds.length,
          isFirstClaim
        };
        return result;
      });
    }
  );

  /**
   * Who took what from whom, for this account, both directions.
   *
   * Losing ground silently is the fastest way to make a territory game feel
   * broken, so the event is a first-class thing to read rather than something to
   * infer from the map changing.
   */
  routes.get(
    '/v1/territory/claims/activity',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryClaimActivityResponseSchema,
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
        taken_from_account_id: string | null;
        taken_by_account_id: string | null;
        rival_id: string | null;
        rival_name: string | null;
        rival_cosmetic: unknown;
        previous_duration_seconds: number;
        new_duration_seconds: number;
        created_at: Date;
      }>(
        `SELECT takeover.id, takeover.taken_from_account_id, takeover.taken_by_account_id,
           rival.account_id AS rival_id, rival.display_name AS rival_name,
           rival.cosmetic AS rival_cosmetic,
           takeover.previous_duration_seconds, takeover.new_duration_seconds,
           takeover.created_at
         FROM territory_claim_takeovers takeover
         LEFT JOIN profiles rival ON rival.account_id = CASE
             WHEN takeover.taken_from_account_id = $1 THEN takeover.taken_by_account_id
             ELSE takeover.taken_from_account_id END
         WHERE takeover.taken_from_account_id = $1 OR takeover.taken_by_account_id = $1
         ORDER BY takeover.created_at DESC
         LIMIT 100`,
        [accountId]
      );

      const response: TerritoryClaimActivityResponse = {
        data: events.rows.map((row) => ({
          id: row.id,
          ...(row.rival_id
            ? {
                rival: {
                  id: row.rival_id,
                  displayName: row.rival_name ?? 'RunSphere member',
                  avatarKey: avatarKeyFrom(row.rival_cosmetic),
                  isSelf: false
                }
              }
            : {}),
          previousDurationSeconds: Number(row.previous_duration_seconds),
          newDurationSeconds: Number(row.new_duration_seconds),
          takenFromSelf: row.taken_from_account_id === accountId,
          createdAt: row.created_at.toISOString()
        }))
      };
      return response;
    }
  );

  /**
   * The story of one piece of ground: every owner it has passed through.
   *
   * Claims are linked by `lineage_id`, set when one takes over another, so this
   * reads as one story rather than as a pile of unrelated polygons. An owner
   * whose account has since been erased appears as a gap — the takeover still
   * happened, and pretending otherwise would leave the record wrong.
   */
  routes.get<{ Params: { claimId: string } }>(
    '/v1/territory/claims/:claimId/history',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritoryClaimParamsSchema,
        response: {
          200: TerritoryClaimHistoryResponseSchema,
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

      const anchor = await database.query<{ lineage_id: string | null }>(
        'SELECT lineage_id FROM territory_claims WHERE id = $1',
        [request.params.claimId]
      );
      const lineageId = anchor.rows[0]?.lineage_id ?? undefined;
      if (!lineageId) return reply.code(404).send({ message: 'Territory not found' });

      const entries = await database.query<{
        id: string;
        account_id: string;
        display_name: string | null;
        cosmetic: unknown;
        duration_seconds: number;
        area_sqm: number;
        claimed_at: Date;
        released_at: Date | null;
      }>(
        `SELECT claim.id, claim.account_id, profile.display_name, profile.cosmetic,
           claim.duration_seconds, claim.area_sqm, claim.claimed_at, claim.released_at
         FROM territory_claims claim
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         WHERE claim.lineage_id = $1
         ORDER BY claim.claimed_at
         LIMIT 100`,
        [lineageId]
      );

      const battles = await database.query<{ attempts: string }>(
        `SELECT count(*)::text AS attempts FROM territory_claim_attempts WHERE lineage_id = $1`,
        [lineageId]
      );
      const failedAttempts = Number(battles.rows[0]?.attempts ?? 0);

      const response: TerritoryClaimHistoryResponse = {
        lineageId,
        captureCount: entries.rows.length,
        // Every challenge: the takeovers that succeeded plus the ones that did
        // not. A first claim is not a battle, so it is not counted as one.
        battleCount: Math.max(0, entries.rows.length - 1) + failedAttempts,
        defendedCount: failedAttempts,
        ...(entries.rows.length > 0
          ? {
              recordSeconds: entries.rows.reduce(
                (best, row) => Math.min(best, Number(row.duration_seconds)),
                Number.MAX_SAFE_INTEGER
              )
            }
          : {}),
        entries: entries.rows.map((row) => ({
          claimId: row.id,
          owner: {
            id: row.account_id,
            displayName: row.display_name ?? 'RunSphere member',
            avatarKey: avatarKeyFrom(row.cosmetic),
            isSelf: row.account_id === accountId
          },
          durationSeconds: Number(row.duration_seconds),
          areaSqm: Number(row.area_sqm),
          claimedAt: row.claimed_at.toISOString(),
          ...(row.released_at ? { releasedAt: row.released_at.toISOString() } : {})
        }))
      };
      return response;
    }
  );

  /**
   * Where the game is being played, for a map zoomed out past individual
   * territories (the world and region views).
   *
   * Claims are grouped on a coarse grid in the database rather than sent and
   * grouped in the app: a world view would otherwise mean shipping every
   * polygon on earth to draw a dozen dots. A cluster carries a count and an
   * area and no identity — enough to show where people run, not enough to
   * locate any one of them.
   */
  routes.get<{ Querystring: TerritoryClaimBounds }>(
    '/v1/territory/claims/clusters',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: TerritoryClaimBoundsSchema,
        response: {
          200: TerritoryClusterListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const { west, south, east, north } = request.query;
      // A grid sized to the viewport, so the same query serves a continent and
      // a county: roughly a 24 x 24 lattice of buckets either way.
      const cellDegrees = Math.max(0.01, Math.abs(north - south) / 24);
      const clusters = await database.query<{
        lng: number;
        lat: number;
        claim_count: string;
        holder_count: string;
        total_area: string;
        includes_self: boolean;
      }>(
        `SELECT avg(ST_X(claim.centroid)) AS lng, avg(ST_Y(claim.centroid)) AS lat,
           count(*)::text AS claim_count,
           count(DISTINCT claim.account_id)::text AS holder_count,
           coalesce(sum(claim.area_sqm), 0)::text AS total_area,
           bool_or(claim.account_id = $5) AS includes_self
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         WHERE claim.released_at IS NULL
           AND account.deleted_at IS NULL
           AND ${notSharingSuspended('claim.account_id')}
           AND claim.centroid && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         GROUP BY floor(ST_X(claim.centroid) / $6), floor(ST_Y(claim.centroid) / $6)
         ORDER BY count(*) DESC
         LIMIT 500`,
        [west, south, east, north, accountId, cellDegrees]
      );

      const response: TerritoryClusterListResponse = {
        clusters: clusters.rows.flatMap((row) =>
          Number.isFinite(row.lng) && Number.isFinite(row.lat)
            ? [
                {
                  centroid: [Number(row.lng), Number(row.lat)] as Coordinate,
                  claimCount: Number(row.claim_count),
                  holderCount: Number(row.holder_count),
                  totalAreaSqm: Number(row.total_area),
                  includesSelf: Boolean(row.includes_self)
                }
              ]
            : []
        )
      };
      return response;
    }
  );

  /**
   * Up to three territories this runner could realistically take today
   * (milestone 5.3).
   *
   * Estimated from their own recent runs — usual distance, usual pace — and
   * nothing else. It reads no location history, no time-of-day pattern, and
   * nobody else's data. Anything more than half again their usual distance is
   * left out on purpose: a suggestion from an app somebody trusts should not be
   * the thing that talks them into a run they are not ready for.
   */
  routes.get<{ Querystring: TerritoryClaimBounds }>(
    '/v1/territory/claims/recommendations',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: TerritoryClaimBoundsSchema,
        response: {
          200: TerritoryRecommendationResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const history = await database.query<{ distance_metres: number; duration_seconds: number }>(
        `SELECT (summary->>'distanceMeters')::double precision AS distance_metres,
           (summary->>'durationSeconds')::double precision AS duration_seconds
         FROM activity_submissions
         WHERE account_id = $1 AND status = 'derived' AND deleted_at IS NULL
           AND summary IS NOT NULL
         ORDER BY processed_at DESC
         LIMIT 30`,
        [accountId]
      );
      const ability = abilityFrom(
        history.rows.flatMap((row) =>
          Number.isFinite(row.distance_metres) && Number.isFinite(row.duration_seconds)
            ? [
                {
                  distanceMetres: Number(row.distance_metres),
                  durationSeconds: Number(row.duration_seconds)
                }
              ]
            : []
        )
      );
      if (!ability) {
        const empty: TerritoryRecommendationResponse = {
          data: [],
          unavailableReason: 'not_enough_runs',
          note: RECOMMENDATION_NOTE
        };
        return empty;
      }

      const { west, south, east, north } = request.query;
      const nearby = await database.query<ClaimRow>(
        `SELECT claim.id, claim.account_id, profile.display_name, profile.cosmetic,
           ST_AsGeoJSON(claim.boundary) AS boundary,
           ST_AsGeoJSON(claim.centroid) AS centroid, claim.area_sqm,
           claim.distance_metres, claim.duration_seconds, claim.capture_count,
           claim.club_id, club.name AS club_name, claim.claimed_at
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN clubs club ON club.id = claim.club_id
         WHERE claim.released_at IS NULL
           AND account.deleted_at IS NULL
           AND claim.account_id <> $5
           AND ${notSharingSuspended('claim.account_id')}
           AND claim.boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         ORDER BY claim.area_sqm DESC
         LIMIT 100`,
        [west, south, east, north, accountId]
      );

      const views = new Map<string, TerritoryClaim>();
      const candidates: CandidateTerritory[] = [];
      for (const row of nearby.rows) {
        const view = claimView(row, accountId);
        if (!view) continue;
        views.set(view.id, view);
        candidates.push({
          claimId: view.id,
          // Rows written before `032` have no stored distance; the boundary is
          // what the runner would have to go round either way.
          perimeterMetres: view.distanceMetres ?? perimeterOf(view.boundary),
          holderDurationSeconds: view.durationSeconds,
          areaSqm: view.areaSqm,
          isSelf: view.owner.isSelf
        });
      }

      const response: TerritoryRecommendationResponse = {
        data: recommendCaptures(ability, candidates).flatMap((recommendation) => {
          const claim = views.get(recommendation.claimId);
          if (!claim || recommendation.difficulty === 'beyond-reach') return [];
          return [
            {
              claim,
              distanceMetres: recommendation.distanceMetres,
              targetSeconds: recommendation.targetSeconds,
              estimatedSeconds: recommendation.estimatedSeconds,
              successProbability: recommendation.successProbability,
              difficulty: recommendation.difficulty,
              efficiency: recommendation.efficiency,
              reason: recommendation.reason
            }
          ];
        }),
        note: RECOMMENDATION_NOTE
      };
      return response;
    }
  );

  /** How much ground the reader holds. Not a rank — divisions do not apply here. */
  routes.get(
    '/v1/territory/claims/summary',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: TerritoryClaimSummarySchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const summary = await database.query<{
        claim_count: string;
        total_area: string | null;
        lost_count: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE released_at IS NULL)::text AS claim_count,
           coalesce(sum(area_sqm) FILTER (WHERE released_at IS NULL), 0)::text AS total_area,
           count(*) FILTER (WHERE released_at IS NOT NULL)::text AS lost_count
         FROM territory_claims WHERE account_id = $1`,
        [accountId]
      );
      const row = summary.rows[0];
      const response: TerritoryClaimSummary = {
        claimCount: Number(row?.claim_count ?? 0),
        totalAreaSqm: Number(row?.total_area ?? 0),
        lostCount: Number(row?.lost_count ?? 0)
      };
      return response;
    }
  );
};
