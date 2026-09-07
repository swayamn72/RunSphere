import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  GhostTraceResponseSchema,
  GhostTraceUnavailableSchema,
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
  type TerritoryCarve,
  type GhostTraceResponse,
  type GhostTraceUnavailable,
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
  H3_VERSION,
  RECOMMENDATION_NOTE,
  RUN_INTEGRITY_MESSAGE,
  abilityFrom,
  assessRunIntegrity,
  canonicaliseRing,
  carveOutcome,
  GHOST_PRIVACY_NOTE,
  GHOST_RULES_NOTE,
  GHOST_TRIM_METRES,
  GHOST_VIEWS_PER_HOUR,
  carveDefended,
  carveSuccess,
  cellSetAreaSqm,
  cellSetBoundary,
  detectCityTag,
  detectClaimTrading,
  detectLoopClaim,
  extractMlRunFeatures,
  ghostIncoming,
  ghostTraceFrom,
  mlLabelFor,
  h3CellSet,
  h3Indexer,
  recommendCaptures,
  ringCentroid,
  runSpeed,
  seasonMonthFor,
  type CandidateTerritory,
  type ClaimPoint,
  type ClaimRing,
  type ContestedHolder,
  type GeoTagResolver,
  type GeoTags,
  type HeldClaim,
  type MlDecision,
  type MlPoint,
  type MlRunFeatures,
  type NotificationCopy,
  type RunIntegrityVerdict
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { adviseOnRun, type MlScorer } from './ml-scoring.js';
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
  /**
   * The anti-cheat model, when one is configured (`ml.md` System 1).
   *
   * Optional on purpose: no scorer means no call and no flag, and a claim goes
   * through exactly as it does today. It is advice, never a gate.
   */
  mlScorer?: MlScorer;
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
interface GeoJsonLineString {
  type: 'LineString';
  coordinates: number[][];
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

/**
 * An open line, every point kept.
 *
 * Deliberately not `ringFromGeoJson`: that one reads a `Polygon` and drops the
 * repeated closing point, which for a ghost trace would silently discard the
 * last vertex and leave the coordinates one shorter than the timing array it
 * has to line up with.
 */
const lineFromGeoJson = (value: unknown): Coordinate[] => {
  const line = asJson<GeoJsonLineString>(value);
  const points = line?.coordinates;
  if (!Array.isArray(points)) return [];
  return points.flatMap((pair) =>
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

/**
 * What a successful claim says.
 *
 * Carving means a run can win and lose in the same breath, and the message has
 * to be true of whichever happened. It never says "you beat them on time",
 * because time is no longer what was compared.
 */
const claimMessage = (carved: number, defended: number, carvedAreaSqm: number): string => {
  const ground = `${Math.round(carvedAreaSqm).toLocaleString('en-IN')} m²`;
  if (carved === 0 && defended === 0) return 'Ground claimed. Nobody held it before you.';
  if (carved === 0)
    return `Ground claimed around ${defended === 1 ? 'a claim' : `${defended} claims`} you did not beat. What was already held stayed held.`;
  const took = `You took ${ground} off ${carved === 1 ? 'the holder' : `${carved} holders`}.`;
  return defended === 0
    ? `Ground claimed. ${took}`
    : `Ground claimed. ${took} ${defended === 1 ? 'One holder' : `${defended} holders`} were faster and kept theirs.`;
};

/**
 * Where a claim is, from the geocode cache and nothing else.
 *
 * **No geocoder at claim time, deliberately.** Resolving a new cell means an
 * outbound HTTP call, and this runs inside the transaction that decides who
 * owns what — a provider that hangs would hold locks on other people's ground
 * until it timed out. So a claim reads the cache, which is an indexed lookup,
 * and takes whatever is there.
 *
 * `038` seeds the cache for the launch market, so an MMR claim is tagged the
 * moment it is made. A claim elsewhere lands untagged, counts on the global
 * board, and is picked up by `territory-geo-backfill.ts` afterwards.
 */
const cachedPlaceResolver = (client: Pick<Database, 'query'>): GeoTagResolver => ({
  cached: async (cell) => {
    const found = await client.query<{
      city_tag: string;
      country_tag: string;
      continent_tag: string;
    }>(
      `SELECT city_tag, country_tag, continent_tag FROM territory_geo_cells
       WHERE h3_cell = $1`,
      [cell]
    );
    const row = found.rows[0];
    return row
      ? { cityTag: row.city_tag, countryTag: row.country_tag, continentTag: row.continent_tag }
      : undefined;
  },
  // Nothing to remember: without a geocoder nothing new is ever resolved here.
  remember: async () => undefined
});

/** Tags for a claim centroid, or nothing. Never throws — a place is not a gate. */
const placeTagsFor = async (
  client: Pick<Database, 'query'>,
  centroid: readonly [number, number]
): Promise<GeoTags | undefined> => {
  const found = await detectCityTag(
    centroid[1],
    centroid[0],
    cachedPlaceResolver(client),
    h3Indexer
  );
  return found
    ? { cityTag: found.cityTag, countryTag: found.countryTag, continentTag: found.continentTag }
    : undefined;
};

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
  /** The loop perimeter. NOT NULL since `036`; the speed to beat divides by it. */
  distance_metres: number;
  duration_seconds: number;
  capture_count: number;
  club_id: string | null;
  club_name: string | null;
  season_month: string;
  city_tag: string | null;
  country_tag: string | null;
  claimed_at: Date;
}

/** Every live-claim read is scoped to the month, which is the reset cycle. */
const CLAIM_COLUMNS = `claim.id, claim.account_id, profile.display_name, profile.cosmetic,
           ST_AsGeoJSON(claim.boundary) AS boundary,
           ST_AsGeoJSON(claim.centroid) AS centroid, claim.area_sqm,
           claim.distance_metres, claim.duration_seconds, claim.capture_count,
           claim.club_id, club.name AS club_name, claim.season_month,
           claim.city_tag, claim.country_tag, claim.claimed_at`;

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
    distanceMetres: Number(row.distance_metres),
    durationSeconds: Number(row.duration_seconds),
    // Derived here rather than in the app: this is the single number the
    // contest turns on, and two clients dividing it differently would show two
    // different targets for the same ground.
    speedMps: runSpeed(Number(row.distance_metres), Number(row.duration_seconds)),
    seasonMonth: row.season_month,
    // Absent rather than a placeholder when the area has no geocode yet: a
    // claim tagged `unknown` would show up as a city on the leaderboard.
    ...(row.city_tag ? { cityTag: row.city_tag } : {}),
    ...(row.country_tag ? { countryTag: row.country_tag } : {}),
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

/**
 * The same points, with the reported GPS accuracy kept.
 *
 * `pointsFrom` drops it because `ClaimPoint` has no use for it, but two of the
 * anti-cheat features are about signal quality — and a synthesised trace is
 * often given away by having none (`ml.md`, "Jitter features").
 */
const mlPointsFrom = (payload: unknown): MlPoint[] => {
  const chunk = payload as { points?: unknown };
  if (!Array.isArray(chunk.points)) return [];
  return chunk.points.flatMap((value) => {
    const raw = value as {
      latitude?: unknown;
      longitude?: unknown;
      recordedAt?: unknown;
      accuracyMeters?: unknown;
    };
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.recordedAt !== 'string'
    )
      return [];
    const at = new Date(raw.recordedAt);
    if (Number.isNaN(at.getTime())) return [];
    return [
      {
        latitude: raw.latitude,
        longitude: raw.longitude,
        at,
        ...(typeof raw.accuracyMeters === 'number' ? { accuracyMetres: raw.accuracyMeters } : {})
      }
    ];
  });
};

/**
 * Store the run's features, and whatever the model made of them.
 *
 * Written for **every** submission that reaches this point, accepted or not.
 * `ml.md` is explicit that the training set needs both: "This trains the ML
 * model to learn what a genuine 'stopped the timer too fast' looks like versus
 * a 'tried to spoof a tiny loop.'" A feature store of successes only would
 * teach the model that everything is normal.
 *
 * Never fails a claim. A feature row is training data; a claim is somebody's
 * run. If the insert fails, the run still counts.
 */
const recordMlFeatures = async (
  database: Pick<Database, 'query'>,
  input: {
    readonly activityId: string;
    readonly features: MlRunFeatures | undefined;
    readonly ruleVerdict: RunIntegrityVerdict;
    readonly decision: MlDecision;
  }
): Promise<void> => {
  if (!input.features) return;
  const { label, source } = mlLabelFor({ ruleVerdict: input.ruleVerdict });
  const f = input.features;
  try {
    await database.query(
      `INSERT INTO ml_run_features (activity_submission_id,
         mean_speed_mps, max_speed_mps, speed_variance, p95_speed_mps, speed_skew,
         mean_horizontal_accuracy_m, accuracy_variance, lateral_deviation_m, signal_loss_gaps,
         mean_turn_rate_deg_per_sec, max_turn_rate_deg_per_sec, sharp_turn_count,
         loop_closure_gap_m, loop_area_sqm, loop_perimeter_m, isoperimetric_ratio,
         total_duration_seconds, total_distance_m, accepted_point_fraction, hour_of_day,
         label, label_source, ml_anomaly_score, ml_model_version, ml_flagged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       ON CONFLICT (activity_submission_id) DO NOTHING`,
      [
        input.activityId,
        f.meanSpeedMps,
        f.maxSpeedMps,
        f.speedVariance,
        f.p95SpeedMps,
        f.speedSkew,
        f.meanHorizontalAccuracyM,
        f.accuracyVariance,
        f.lateralDeviationM,
        f.signalLossGaps,
        f.meanTurnRateDegPerSec,
        f.maxTurnRateDegPerSec,
        f.sharpTurnCount,
        f.loopClosureGapM,
        f.loopAreaSqm,
        f.loopPerimeterM,
        f.isoperimetricRatio,
        f.totalDurationSeconds,
        f.totalDistanceM,
        f.acceptedPointFraction,
        f.hourOfDay,
        label,
        source,
        input.decision.confidence ?? null,
        input.decision.modelVersion ?? null,
        input.decision.flagged
      ]
    );
  } catch {
    // Deliberately swallowed. See above: a claim must not fail because its
    // training row did.
  }
};

/**
 * Tells one holder what happened to their ground.
 *
 * Three refusals live here rather than at each call site, because every one of
 * them is a rule `screens.md` states for *all* notifications and each was easy
 * to forget once:
 *
 *   * **Never yourself.** Running over your own ground is ordinary - a second
 *     lap contests the first - and is not news.
 *   * **Never across a block.** "Blocked users never appear in any
 *     notification", checked both ways: a notice naming somebody you blocked
 *     is as wrong as one naming you to somebody who blocked you.
 *   * **Never twice for the same event.** The key is the *activity* and the
 *     holder's claim, not the new claim, because a rolled-back and retried
 *     submission produces a fresh claim id but the same run.
 *
 * Written inside the claim transaction, so a carve and the notice about it are
 * committed together or not at all. A notice about a carve that did not happen
 * is worse than a carve nobody was told about.
 */
const queueClaimNotice = async (
  client: Pick<Database, 'query'>,
  options: {
    readonly recipientAccountId: string;
    readonly challengerAccountId: string;
    readonly copy: NotificationCopy;
    readonly dedupeKey: string;
  }
): Promise<void> => {
  if (options.recipientAccountId === options.challengerAccountId) return;
  const blocked = await client.query<{ blocked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
       AND ((block.blocker_account_id = $1 AND block.blocked_account_id = $2)
         OR (block.blocker_account_id = $2 AND block.blocked_account_id = $1))) AS blocked`,
    [options.recipientAccountId, options.challengerAccountId]
  );
  if (blocked.rows[0]?.blocked) return;
  await client.query(
    `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      options.recipientAccountId,
      options.copy.kind,
      options.copy.title,
      options.copy.body,
      options.copy.deepLink,
      options.dedupeKey
    ]
  );
};

export const registerTerritoryClaimRoutes = ({
  routes,
  database,
  authSecret,
  mlScorer
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
      // Scoped to the month: a claim from a finished season is history, and the
      // live map is this season's ground. The reset job archives them; this
      // filter means the month boundary is correct even before it has run.
      const found = await database.query<ClaimRow>(
        `SELECT ${CLAIM_COLUMNS}
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN clubs club ON club.id = claim.club_id
         WHERE claim.released_at IS NULL
           AND claim.season_month = $6
           AND account.deleted_at IS NULL
           AND ${notSharingSuspended('claim.account_id')}
           AND claim.boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         ORDER BY claim.area_sqm DESC
         LIMIT $5`,
        [west, south, east, north, MAP_LIMIT + 1, seasonMonthFor(new Date())]
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
          carves: [],
          takenOverCount: 0,
          carvedAreaSqm: 0,
          isFirstClaim: false
        };
        return result;
      }

      /**
       * The advisory ML step (`ml.md`, "Integration into the Run Submission
       * Pipeline"): after the rule-based gates, before the claim is written.
       *
       * Two things it deliberately is not. It is not a gate — the strongest
       * outcome is `hold_for_review`, and `run-integrity.ts` remains the only
       * thing that can refuse a run. And it is not on the critical path — an
       * unconfigured or unreachable scorer costs nothing and decides nothing.
       */
      const mlFeatures = extractMlRunFeatures(
        chunks.rows.flatMap((row) => mlPointsFrom(row.payload))
      );
      const mlDecision = await adviseOnRun(
        { database, ...(mlScorer ? { scorer: mlScorer } : {}) },
        { features: mlFeatures, ruleVerdict: integrity.verdict }
      );
      // Written for every submission that got this far, accepted or not: the
      // model learns the difference between a short honest run and a spoofed
      // one only if it is shown both.
      await recordMlFeatures(database, {
        activityId: request.body.activityId,
        features: mlFeatures,
        ruleVerdict: integrity.verdict,
        decision: mlDecision
      });

      const detection = detectLoopClaim(points, DEFAULT_CLAIM_RULE);
      if (!('claim' in detection)) {
        const result: TerritoryClaimResult = {
          claimed: false,
          refusal: detection.refusal,
          message: CLAIM_REFUSAL_MESSAGE[detection.refusal],
          carves: [],
          takenOverCount: 0,
          carvedAreaSqm: 0,
          isFirstClaim: false
        };
        return result;
      }
      const candidate = detection.claim;

      /**
       * The ghost, built from the loop this claim was decided on.
       *
       * Computed here rather than on request because the points are already in
       * hand, and because the raw trace is purged after 30 days
       * (`activity_submissions.raw_trace_retention_until`) while a claim lives
       * until the season ends — a claim whose trace had aged out would lose
       * its ghost partway through the month.
       *
       * A refusal is not a refusal of the *claim*. A loop too short to trim
       * 200 m off each end is a perfectly good claim that simply cannot be
       * shown as a ghost without publishing the arc the trim exists to hide
       * (`ghost-race.ts`), so the claim stands and no ghost row is written.
       */
      const ghost = ghostTraceFrom(points, candidate, GHOST_TRIM_METRES);

      // Rotated to a vertex chosen by geography before anything is stored: a
      // polygon never showed where somebody started, but the array did, and on
      // a loop run from home the first coordinate is the front door.
      const boundary = canonicaliseRing(candidate.boundary);
      const boundaryJson = polygonGeoJson(boundary);

      // The ground, as cells. Everything downstream — what overlaps, what is
      // carved, what survives, what the claim is worth — is set arithmetic on
      // this array rather than polygon intersection, which is the change
      // `territory-guide.md` v3 asks for.
      const candidateCells = h3CellSet(boundary, DEFAULT_CLAIM_RULE.h3Resolution, h3Indexer);
      if (cellSetAreaSqm(candidateCells, h3Indexer) < DEFAULT_CLAIM_RULE.minAreaSqm) {
        // The polygon cleared the floor but the cells it covers do not. At
        // resolution 11 a cell is ~1,963 m², so a loop just over 5,000 m² can
        // round below it. The cells are what would be held, so the cells decide.
        const result: TerritoryClaimResult = {
          claimed: false,
          refusal: 'too_small',
          message: CLAIM_REFUSAL_MESSAGE.too_small,
          carves: [],
          takenOverCount: 0,
          carvedAreaSqm: 0,
          isFirstClaim: false
        };
        return result;
      }

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
          carves: [],
          takenOverCount: 0,
          carvedAreaSqm: 0,
          isFirstClaim: false
        };
        return result;
      }

      const seasonMonth = seasonMonthFor(new Date());

      return withTransaction(database, async (client) => {
        // Lock every claim this loop could contest before deciding anything, so
        // two runners finishing together cannot both be told they won.
        //
        // Two overlap tests, deliberately. `h3_cell_set &&` is the real one and
        // uses the GIN index from `036`. `boundary &&` is there for claims
        // written before `036`, which have no cells at all and would otherwise
        // be invisible to carving — meaning anybody could claim straight over
        // them. Those rows get their cells computed below, once.
        const contested = await client.query<{
          id: string;
          account_id: string;
          area_sqm: number;
          distance_metres: number;
          duration_seconds: number;
          capture_count: number;
          lineage_id: string | null;
          h3_cell_set: string[] | null;
          h3_resolution: number;
          city_tag: string | null;
          boundary: unknown;
        }>(
          `SELECT claim.id, claim.account_id, claim.area_sqm, claim.distance_metres,
             claim.duration_seconds, claim.capture_count, claim.lineage_id,
             claim.h3_cell_set, claim.h3_resolution, claim.city_tag,
             ST_AsGeoJSON(claim.boundary) AS boundary
           FROM territory_claims claim
           WHERE claim.released_at IS NULL
             AND claim.season_month = $3
             AND (claim.h3_cell_set && $1::text[]
                  OR claim.boundary && ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
           FOR UPDATE`,
          [candidateCells, boundaryJson, seasonMonth]
        );

        // Display identity for everyone involved, in one read.
        const holderIds = [...new Set(contested.rows.map((row) => row.account_id))];
        const holderProfiles = new Map<
          string,
          { display_name: string | null; cosmetic: unknown }
        >();
        if (holderIds.length > 0) {
          const profiles = await client.query<{
            account_id: string;
            display_name: string | null;
            cosmetic: unknown;
          }>('SELECT account_id, display_name, cosmetic FROM profiles WHERE account_id = ANY($1)', [
            holderIds
          ]);
          for (const profile of profiles.rows) holderProfiles.set(profile.account_id, profile);
        }

        // The challenger's own name, for the notices the holders get. Read
        // separately because the challenger is only in `holderProfiles` when
        // they are contesting their own earlier claim, which is a case that
        // sends nothing.
        const challenger = await client.query<{ display_name: string | null }>(
          'SELECT display_name FROM profiles WHERE account_id = $1',
          [accountId]
        );
        const challengerName = challenger.rows[0]?.display_name ?? undefined;

        const held: HeldClaim[] = [];
        for (const row of contested.rows) {
          let cellSet: readonly string[] = row.h3_cell_set ?? [];
          // Repaired lazily, inside the deciding transaction, when a claim has
          // no cells or was indexed at a resolution the current rule no longer
          // uses. Comparing two sets at different resolutions intersects to
          // nothing and would hand over held ground in silence, so it is fixed
          // rather than tolerated.
          if (
            cellSet.length === 0 ||
            Number(row.h3_resolution) !== DEFAULT_CLAIM_RULE.h3Resolution
          ) {
            cellSet = h3CellSet(
              ringFromGeoJson(row.boundary),
              DEFAULT_CLAIM_RULE.h3Resolution,
              h3Indexer
            );
            if (cellSet.length > 0) {
              await client.query(
                `UPDATE territory_claims
                 SET h3_cell_set = $2::text[], h3_resolution = $3, h3_version = $4
                 WHERE id = $1`,
                [row.id, cellSet, DEFAULT_CLAIM_RULE.h3Resolution, H3_VERSION]
              );
            }
          }
          if (cellSet.length === 0) continue;
          held.push({
            id: row.id,
            cellSet,
            areaSqm: Number(row.area_sqm),
            perimeterMetres: Number(row.distance_metres),
            durationSeconds: Number(row.duration_seconds)
          });
        }

        const outcome = carveOutcome(
          candidate,
          candidateCells,
          held,
          h3Indexer,
          DEFAULT_CLAIM_RULE
        );

        /** One contest, as the post-run screen shows it. */
        const carveView = (entry: ContestedHolder, carved: boolean): TerritoryCarve => {
          const row = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
          const profile = holderProfiles.get(row?.account_id ?? '');
          return {
            carved,
            ...(row
              ? {
                  holder: {
                    id: row.account_id,
                    displayName: profile?.display_name ?? 'RunSphere member',
                    avatarKey: avatarKeyFrom(profile?.cosmetic ?? null),
                    isSelf: row.account_id === accountId
                  }
                }
              : {}),
            areaSqm: carved ? cellSetAreaSqm(entry.carvedCells, h3Indexer) : 0,
            yourSpeedMps: entry.assessment.challengerSpeedMps,
            theirSpeedMps: entry.assessment.holderSpeedMps,
            graceApplied: entry.assessment.graceApplied,
            effectiveSpeedMps: entry.assessment.effectiveSpeedMps,
            holderWipedOut: entry.wipedOut,
            overlapTooSmall:
              !carved && entry.assessment.intersectionAreaSqm < entry.assessment.minCarveAreaSqm
          };
        };

        /** A challenge that came up short, so a territory can count its defences. */
        const recordAttempt = async (entry: ContestedHolder): Promise<void> => {
          const row = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
          if (!row) return;
          const tooSmall = entry.assessment.intersectionAreaSqm < entry.assessment.minCarveAreaSqm;
          await client.query(
            `INSERT INTO territory_claim_attempts (lineage_id, defending_claim_id,
               defending_account_id, challenger_account_id, holder_duration_seconds,
               challenger_duration_seconds, effort_ratio, grace_applied,
               effective_speed_mps, holder_speed_mps, outcome)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              row.lineage_id ?? row.id,
              row.id,
              row.account_id,
              accountId,
              Number(row.duration_seconds),
              candidate.durationSeconds,
              entry.assessment.effortRatio,
              entry.assessment.graceApplied,
              entry.assessment.effectiveSpeedMps,
              entry.assessment.holderSpeedMps,
              tooSmall ? 'overlap_too_small' : 'slower'
            ]
          );
        };

        if ('refusal' in outcome) {
          // Nothing survived. Every contest still happened, and each one is the
          // other half of the record: it is what lets a territory say how often
          // it has been *held*, not only how often it changed hands.
          // Every holder here kept their ground, and this is the commonest way
          // that happens: somebody ran the loop and was not fast enough. It
          // would be strange to tell a defender only when the challenger
          // succeeded somewhere else.
          for (const entry of outcome.contested) {
            await recordAttempt(entry);
            const previous = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
            if (!previous) continue;
            await queueClaimNotice(client, {
              recipientAccountId: previous.account_id,
              challengerAccountId: accountId,
              copy: carveDefended({
                claimId: entry.id,
                runnerName: challengerName,
                ...(previous.city_tag ? { areaName: previous.city_tag } : {})
              }),
              dedupeKey: `defended:${request.body.activityId}:${entry.id}`
            });
          }
          const result: TerritoryClaimResult = {
            claimed: false,
            refusal: outcome.refusal,
            message: CLAIM_REFUSAL_MESSAGE[outcome.refusal],
            carves: outcome.contested.map((entry) => carveView(entry, false)),
            takenOverCount: 0,
            carvedAreaSqm: 0,
            isFirstClaim: false
          };
          return result;
        }

        for (const entry of outcome.defended) {
          await recordAttempt(entry);
          const previous = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
          if (!previous) continue;
          await queueClaimNotice(client, {
            recipientAccountId: previous.account_id,
            challengerAccountId: accountId,
            copy: carveDefended({
              claimId: entry.id,
              runnerName: challengerName,
              ...(previous.city_tag ? { areaName: previous.city_tag } : {})
            }),
            dedupeKey: `defended:${request.body.activityId}:${entry.id}`
          });
        }

        // The ground actually claimed. When an undefeated holder kept part of
        // the loop, the stored polygon has to be redrawn from the cells that
        // survived — otherwise the map would show this account territory it does
        // not hold, which is the one thing a territory map must not do.
        const withheldAny = outcome.cellSet.length !== candidateCells.length;
        const claimBoundary = withheldAny
          ? cellSetBoundary(outcome.cellSet, h3Indexer, DEFAULT_CLAIM_RULE)
          : boundary;
        if (claimBoundary.length < 3) throw new Error('carved claim has no drawable boundary');
        const claimCentroid = withheldAny ? ringCentroid(claimBoundary) : candidate.centroid;

        // Lineage and parentage follow the *largest* carve. Only one of each can
        // be stored, and a run that carves three neighbours belongs most to the
        // ground it took most of.
        const carvedBySize = [...outcome.carved].sort(
          (left, right) => right.carvedCells.length - left.carvedCells.length
        );
        const principalRow = carvedBySize[0]
          ? contested.rows.find((row) => row.id === carvedBySize[0]!.id)
          : undefined;
        const inheritedLineage = principalRow?.lineage_id ?? principalRow?.id;
        const captureCount =
          carvedBySize.reduce((most, entry) => {
            const row = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
            return Math.max(most, Number(row?.capture_count ?? 1));
          }, 0) + 1;

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

        // Where this ground is, read from the cache before the insert so the
        // claim lands on its city board immediately rather than on the next
        // backfill sweep.
        const place = await placeTagsFor(client, claimCentroid);

        const inserted = await client.query<ClaimRow>(
          `INSERT INTO territory_claims (account_id, activity_id, boundary, centroid,
             area_sqm, distance_metres, duration_seconds, capture_count,
             previous_owner_account_id, club_id, lineage_id, h3_cell_set, h3_resolution,
             h3_version, season_month, parent_claim_id, city_tag, country_tag,
             continent_tag)
           VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
             ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11,
             coalesce($12::uuid, gen_random_uuid()), $13::text[], $14, $15, $16, $17,
             $18, $19, $20)
           RETURNING id, account_id, ST_AsGeoJSON(boundary) AS boundary,
             ST_AsGeoJSON(centroid) AS centroid, area_sqm, distance_metres,
             duration_seconds, capture_count, club_id, season_month, city_tag,
             country_tag, claimed_at`,
          [
            accountId,
            request.body.activityId,
            polygonGeoJson(claimBoundary),
            claimCentroid[0],
            claimCentroid[1],
            // Area follows the cells, never the polygon: it is the ground held,
            // and the only figure consistent with the carve arithmetic that
            // produced it.
            outcome.areaSqm,
            // The distance the runner covered around the loop. A carve never
            // changes it — their run is their run, and it is the perimeter half
            // of the speed a future challenger has to beat.
            candidate.perimeterMetres,
            candidate.durationSeconds,
            captureCount,
            principalRow?.account_id ?? null,
            membership.rows[0]?.club_id ?? null,
            inheritedLineage ?? null,
            outcome.cellSet,
            DEFAULT_CLAIM_RULE.h3Resolution,
            H3_VERSION,
            seasonMonth,
            principalRow?.id ?? null,
            place?.cityTag ?? null,
            place?.countryTag ?? null,
            place?.continentTag ?? null
          ]
        );
        const row = inserted.rows[0];
        if (!row) throw new Error('territory claim insert returned no row');

        if ('trace' in ghost) {
          // The trimmed line and the timing that goes with it. `043` checks
          // that the two arrays are the same length, so a mismatch is a failed
          // insert rather than a ghost that drifts out of time with itself.
          await client.query(
            `INSERT INTO territory_claim_ghost_traces (claim_id, path, elapsed_seconds,
               distance_metres, duration_seconds, trim_metres)
             VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3::integer[], $4, $5, $6)
             ON CONFLICT (claim_id) DO NOTHING`,
            [
              row.id,
              JSON.stringify({
                type: 'LineString',
                coordinates: ghost.trace.points.map((point) => [point.longitude, point.latitude])
              }),
              ghost.trace.points.map((point) => point.elapsedSeconds),
              ghost.trace.distanceMetres,
              ghost.trace.durationSeconds,
              ghost.trace.trimMetres
            ]
          );
        }

        let carvedAreaSqm = 0;
        for (const entry of outcome.carved) {
          const previous = contested.rows.find((candidateRow) => candidateRow.id === entry.id);
          if (!previous) continue;
          const carvedArea = cellSetAreaSqm(entry.carvedCells, h3Indexer);
          carvedAreaSqm += carvedArea;

          if (entry.wipedOut) {
            // Nothing defensible left, so the claim is released whole rather
            // than left as a sliver. Rows are never deleted.
            await client.query(
              `UPDATE territory_claims SET released_at = now(), released_to_claim_id = $2
               WHERE id = $1 AND released_at IS NULL`,
              [entry.id, row.id]
            );
          } else {
            // The holder keeps the rest. Their perimeter and duration are left
            // alone: those record the run they did, and changing them would
            // rewrite a speed somebody has already been measured against.
            const survivingBoundary = cellSetBoundary(
              entry.survivingCells,
              h3Indexer,
              DEFAULT_CLAIM_RULE
            );
            if (survivingBoundary.length < 3)
              throw new Error('carved holder has no drawable boundary');
            const survivingCentroid = ringCentroid(survivingBoundary);
            await client.query(
              `UPDATE territory_claims
               SET h3_cell_set = $2::text[], area_sqm = $3,
                 boundary = ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
                 centroid = ST_SetSRID(ST_MakePoint($5, $6), 4326),
                 h3_resolution = $7, h3_version = $8
               WHERE id = $1 AND released_at IS NULL`,
              [
                entry.id,
                entry.survivingCells,
                entry.survivingAreaSqm,
                polygonGeoJson(survivingBoundary),
                survivingCentroid[0],
                survivingCentroid[1],
                DEFAULT_CLAIM_RULE.h3Resolution,
                H3_VERSION
              ]
            );
          }

          await queueClaimNotice(client, {
            recipientAccountId: previous.account_id,
            challengerAccountId: accountId,
            copy: carveSuccess({
              claimId: entry.id,
              runnerName: challengerName,
              ...(previous.city_tag ? { areaName: previous.city_tag } : {}),
              takenSqm: carvedArea,
              // A wipe-out leaves nothing, and the copy says so rather than
              // reporting 0 m² still held.
              heldSqm: entry.wipedOut ? 0 : entry.survivingAreaSqm
            }),
            dedupeKey: `carve:${request.body.activityId}:${entry.id}`
          });

          await client.query(
            `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
               taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
               new_duration_seconds, kind, carved_area_sqm, carved_cell_count,
               holder_survived, effort_ratio, grace_applied, effective_speed_mps,
               holder_speed_mps)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              entry.id,
              previous.account_id,
              row.id,
              accountId,
              Number(previous.duration_seconds),
              candidate.durationSeconds,
              entry.wipedOut ? 'takeover' : 'carve',
              carvedArea,
              entry.carvedCells.length,
              !entry.wipedOut,
              entry.assessment.effortRatio,
              entry.assessment.graceApplied,
              entry.assessment.effectiveSpeedMps,
              entry.assessment.holderSpeedMps
            ]
          );
        }

        // Ground that keeps going back and forth between the same two people is
        // worth a human looking at. Written as a question, never acted on: two
        // friends who race each other every week produce the same pattern, and
        // nothing in the data separates them (`claim-trading.ts`).
        if (outcome.carved.length > 0 && inheritedLineage) {
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
          message: claimMessage(outcome.carved.length, outcome.defended.length, carvedAreaSqm),
          carves: [
            ...outcome.carved.map((entry) => carveView(entry, true)),
            ...outcome.defended.map((entry) => carveView(entry, false))
          ],
          takenOverCount: outcome.carved.length,
          carvedAreaSqm,
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
   * The holder's run, as a ghost to race (`territory-guide.md` "Ghost Race").
   *
   * Five gates, in this order and for these reasons:
   *
   *   1. **The claim must still be held.** A released claim is somebody's
   *      former ground; racing its ghost would be racing a contest that is
   *      already over.
   *   2. **Not your own.** `screens.md` 1.3: "No Ghost Race button on your own
   *      territory." Checked on the server too, because a client can ask.
   *   3. **Not across a block**, in either direction.
   *   4. **The same region.** `territory-guide.md` limits a ghost to users "in
   *      the same region", and region here is the city the requester has held
   *      ground in this season — the only region signal the server has without
   *      collecting a position for the purpose. **A requester who holds no
   *      ground anywhere is allowed through**, deliberately: Ghost Race is a
   *      hook for somebody who has not claimed yet, and locking it to existing
   *      holders would remove it from exactly the people it is for. What bounds
   *      them is the hourly budget. Closing the gap properly needs a coarse
   *      position on the request, which is a new collection and is not done.
   *   5. **Three an hour**, counted in the database.
   *
   * The order matters: every refusal above the rate limit is about the
   * *requester's relationship to this claim*, so none of them spends a view.
   */
  routes.get<{ Params: { claimId: string } }>(
    '/v1/territory/claims/:claimId/ghost-trace',
    {
      schema: {
        tags: ['territory'],
        headers: ActivityAuthorizationHeadersSchema,
        params: TerritoryClaimParamsSchema,
        response: {
          200: GhostTraceResponseSchema,
          401: ErrorResponseSchema,
          403: GhostTraceUnavailableSchema,
          404: GhostTraceUnavailableSchema,
          429: GhostTraceUnavailableSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const unavailable = (
        code: 403 | 404 | 429,
        reason: GhostTraceUnavailable['reason'],
        message: string
      ) => reply.code(code).send({ reason, message });

      const claim = await database.query<{
        id: string;
        account_id: string;
        city_tag: string | null;
        claimed_at: Date;
        display_name: string | null;
        cosmetic: unknown;
        path: unknown;
        elapsed_seconds: number[] | null;
        distance_metres: number | null;
        duration_seconds: number | null;
        trim_metres: number | null;
      }>(
        `SELECT claim.id, claim.account_id, claim.city_tag, claim.claimed_at,
           profile.display_name, profile.cosmetic,
           ST_AsGeoJSON(ghost.path) AS path, ghost.elapsed_seconds,
           ghost.distance_metres, ghost.duration_seconds, ghost.trim_metres
         FROM territory_claims claim
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN territory_claim_ghost_traces ghost ON ghost.claim_id = claim.id
         WHERE claim.id = $1 AND claim.released_at IS NULL`,
        [request.params.claimId]
      );
      const row = claim.rows[0];
      // One answer for "no such claim" and "no longer held", because which of
      // the two it is is not the asker's business.
      if (!row)
        return unavailable(404, 'not_held', 'This ground is not held by anybody right now.');

      if (row.account_id === accountId)
        return unavailable(403, 'own_claim', 'This is your own ground. There is no ghost to race.');

      const blocked = await database.query<{ blocked: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
           AND ((block.blocker_account_id = $1 AND block.blocked_account_id = $2)
             OR (block.blocker_account_id = $2 AND block.blocked_account_id = $1))) AS blocked`,
        [accountId, row.account_id]
      );
      // Answered as "not held" rather than "you are blocked": a refusal that
      // names the block tells the asker something about the holder's choices.
      if (blocked.rows[0]?.blocked)
        return unavailable(404, 'not_held', 'This ground is not held by anybody right now.');

      if (row.city_tag) {
        const mine = await database.query<{ city_tag: string }>(
          `SELECT DISTINCT city_tag FROM territory_claims
           WHERE account_id = $1 AND released_at IS NULL AND season_month = $2
             AND city_tag IS NOT NULL`,
          [accountId, seasonMonthFor(new Date())]
        );
        const cities = mine.rows.map((place) => place.city_tag);
        if (cities.length > 0 && !cities.includes(row.city_tag))
          return unavailable(
            403,
            'out_of_region',
            'Ghost races are limited to places you have run in this season.'
          );
      }

      if (!row.path || !row.elapsed_seconds || !row.duration_seconds)
        return unavailable(
          404,
          'no_trace',
          'This run cannot be shown as a ghost. Its loop was too short to trim safely, or it was claimed before ghost races existed.'
        );

      const views = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claim_ghost_views
         WHERE account_id = $1 AND created_at > now() - interval '1 hour'`,
        [accountId]
      );
      const used = Number(views.rows[0]?.count ?? 0);
      if (used >= GHOST_VIEWS_PER_HOUR)
        return unavailable(
          429,
          'rate_limited',
          `Ghost races are limited to ${GHOST_VIEWS_PER_HOUR} an hour. Try again shortly.`
        );

      const coordinates = lineFromGeoJson(row.path);
      const elapsed = row.elapsed_seconds;
      // The `043` constraint makes this impossible, so it is a guard against a
      // row written around it rather than an expected case.
      if (coordinates.length !== elapsed.length)
        return unavailable(404, 'no_trace', 'This run cannot be shown as a ghost.');

      await withTransaction(database, async (client) => {
        await client.query(
          'INSERT INTO territory_claim_ghost_views (account_id, claim_id) VALUES ($1, $2)',
          [accountId, row.id]
        );
        // `GHOST_INCOMING` (`screens.md` push catalogue). Written in the same
        // transaction as the view, so the holder is told exactly as often as
        // their pacing is handed out — no more, and no less.
        //
        // The key is the pair, not the view: somebody who opens the sheet
        // three times in an hour has not started three races, and three
        // identical notices would read as harassment.
        await client.query(
          `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link, dedupe_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          (() => {
            const copy = ghostIncoming({
              claimId: row.id,
              runnerName: undefined
            });
            return [
              row.account_id,
              copy.kind,
              copy.title,
              copy.body,
              copy.deepLink,
              `ghost:${row.id}:${accountId}`
            ];
          })()
        );
      });

      const response: GhostTraceResponse = {
        claimId: row.id,
        owner: {
          id: row.account_id,
          displayName: row.display_name ?? 'RunSphere member',
          avatarKey: avatarKeyFrom(row.cosmetic ?? null),
          isSelf: false
        },
        points: coordinates.map((coordinate, index) => ({
          at: [coordinate[0], coordinate[1]] as Coordinate,
          elapsedSeconds: Number(elapsed[index] ?? 0)
        })),
        distanceMetres: Number(row.distance_metres ?? 0),
        durationSeconds: Number(row.duration_seconds),
        trimMetres: Number(row.trim_metres ?? GHOST_TRIM_METRES),
        // Date only. When somebody runs is a routine, and a routine is not
        // something a stranger needs from a claim.
        recordedOn: row.claimed_at.toISOString().slice(0, 10),
        privacyNote: GHOST_PRIVACY_NOTE,
        rulesNote: GHOST_RULES_NOTE,
        viewsRemaining: Math.max(0, GHOST_VIEWS_PER_HOUR - used - 1)
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
           AND claim.season_month = $7
           AND claim.centroid && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         GROUP BY floor(ST_X(claim.centroid) / $6), floor(ST_Y(claim.centroid) / $6)
         ORDER BY count(*) DESC
         LIMIT 500`,
        [west, south, east, north, accountId, cellDegrees, seasonMonthFor(new Date())]
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
        `SELECT ${CLAIM_COLUMNS}
         FROM territory_claims claim
         JOIN accounts account ON account.id = claim.account_id
         LEFT JOIN profiles profile ON profile.account_id = claim.account_id
         LEFT JOIN clubs club ON club.id = claim.club_id
         WHERE claim.released_at IS NULL
           AND claim.season_month = $6
           AND account.deleted_at IS NULL
           AND claim.account_id <> $5
           AND ${notSharingSuspended('claim.account_id')}
           AND claim.boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         ORDER BY claim.area_sqm DESC
         LIMIT 100`,
        [west, south, east, north, accountId, seasonMonthFor(new Date())]
      );

      const views = new Map<string, TerritoryClaim>();
      const candidates: CandidateTerritory[] = [];
      for (const row of nearby.rows) {
        const view = claimView(row, accountId);
        if (!view) continue;
        views.set(view.id, view);
        candidates.push({
          claimId: view.id,
          perimeterMetres: view.distanceMetres,
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
           count(*) FILTER (WHERE released_at IS NULL AND season_month = $2)::text AS claim_count,
           coalesce(sum(area_sqm) FILTER (WHERE released_at IS NULL AND season_month = $2), 0)::text
             AS total_area,
           count(*) FILTER (WHERE released_at IS NOT NULL)::text AS lost_count
         FROM territory_claims WHERE account_id = $1`,
        [accountId, seasonMonthFor(new Date())]
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
