import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  RouteSuggestionFeedbackRequestSchema,
  RouteSuggestionFeedbackResponseSchema,
  RouteSuggestionQuerySchema,
  RouteSuggestionResponseSchema,
  type Coordinate,
  type RouteSuggestionFeedbackRequest,
  type RouteSuggestionFeedbackResponse,
  type RouteSuggestionQuery,
  type RouteSuggestionResponse
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  DEFAULT_ROUTE_SUGGESTION_RULE,
  ROUTE_SUGGESTION_NOTE,
  SUGGESTION_UNAVAILABLE_MESSAGE,
  abilityFrom,
  distanceTargetFor,
  rankRoutes,
  suggestionUnavailableReason,
  type CandidateRoute,
  type RunnerContext
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * Route suggestions (`product.md`; pending-work 3.1).
 *
 * Answers "what could I run from about here", from loops a person reviewed and
 * published. `041_curated_routes.sql` records why they are chosen rather than
 * generated, and `route-suggestion.ts` holds the rules for choosing.
 *
 * **The dataset ships empty**, so this answers `no_curated_routes` until routes
 * are published — the same honest-when-unconfigured treatment FCM, email, and
 * the geocoder get. Everything around it is real: the ranking, the guardrails,
 * the coarse-location handling, and the feedback that stops re-offering a loop
 * somebody keeps passing on.
 *
 * **What this endpoint does with position.** It takes a coordinate, snaps it to
 * a coarse grid before touching the database, uses the snapped point, and
 * stores neither. `product.md` asks only for coarse input; snapping makes that
 * true of the server's own behaviour rather than a request the client is
 * trusted to honour.
 */
export interface RouteSuggestionRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

/**
 * How coarsely an incoming position is treated: about 1.1 km of latitude.
 *
 * Chosen against what it is used for. A suggestion asks "is this loop within
 * 1.5 km of you", and 0.01 degrees is well inside the slack that question
 * already has — so snapping costs nothing in usefulness. What it buys is that
 * every runner in a square kilometre sends the same value, so the coordinate
 * reaching the query names a neighbourhood rather than a person.
 *
 * A client that sends a precise fix therefore cannot make the server hold one.
 */
const COARSE_DEGREES = 0.01;

const snapCoarse = (value: number): number => Math.round(value / COARSE_DEGREES) * COARSE_DEGREES;

const RouteParamsSchema = {
  type: 'object',
  required: ['routeId'],
  additionalProperties: false,
  properties: { routeId: { type: 'string', format: 'uuid' } }
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

interface RouteRow {
  id: string;
  name: string;
  family_key: string;
  path: unknown;
  start_point: unknown;
  distance_metres: number;
  start_distance_metres: number;
  surface: 'paved' | 'track' | 'trail' | 'mixed';
  lit: boolean;
  traffic_exposure: 'none' | 'low' | 'moderate';
  accessibility: 'step-free' | 'mixed' | 'unknown';
  declined_at: Date | null;
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

/** A published loop is stored closed, and the contract carries it closed too. */
const lineFromGeoJson = (value: unknown): Coordinate[] => {
  const line = asJson<{ coordinates?: number[][] }>(value);
  const points = line?.coordinates;
  if (!Array.isArray(points)) return [];
  return points.flatMap((pair) =>
    Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number'
      ? [[pair[0], pair[1]] as Coordinate]
      : []
  );
};

const pointFromGeoJson = (value: unknown): Coordinate | undefined => {
  const point = asJson<{ coordinates?: number[] }>(value);
  const pair = point?.coordinates;
  return Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number'
    ? [pair[0], pair[1]]
    : undefined;
};

export const registerRouteSuggestionRoutes = ({
  routes,
  database,
  authSecret
}: RouteSuggestionRouteDeps): void => {
  /**
   * Up to three reviewed loops that could be run from about here.
   *
   * The distance is either what the runner asked for, or what their own recent
   * running suggests, or shorter than both if they have run a lot this week.
   * Nothing in the ordering reads pace (`route-suggestion.ts`).
   */
  routes.get<{ Querystring: RouteSuggestionQuery }>(
    '/v1/routes/suggest',
    {
      schema: {
        tags: ['routes'],
        headers: ActivityAuthorizationHeadersSchema,
        querystring: RouteSuggestionQuerySchema,
        response: {
          200: RouteSuggestionResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      // Coarsened before it is used for anything, and never stored.
      const latitude = snapCoarse(request.query.latitude);
      const longitude = snapCoarse(request.query.longitude);
      const now = new Date();

      // Their own recent runs, for the distance they usually cover and — only
      // to answer a time budget — the pace they usually run it at.
      const history = await database.query<{
        distance_metres: number;
        duration_seconds: number;
      }>(
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

      // Recent load, against their own trailing median. Minutes only: this
      // decides whether to offer something shorter and reads no pace.
      const load = await database.query<{ recent: string | null; median: string | null }>(
        `WITH weekly AS (
           SELECT date_trunc('week', submission.processed_at) AS week,
             sum(output.active_duration_seconds) / 60.0 AS minutes
           FROM activity_submissions submission
           JOIN activity_validation_outputs output ON output.activity_id = submission.id
           WHERE submission.account_id = $1 AND submission.deleted_at IS NULL
             AND submission.processed_at >= now() - interval '28 days'
           GROUP BY 1
         )
         SELECT
           (SELECT coalesce(sum(output.active_duration_seconds) / 60.0, 0)::text
              FROM activity_submissions submission
              JOIN activity_validation_outputs output ON output.activity_id = submission.id
              WHERE submission.account_id = $1 AND submission.deleted_at IS NULL
                AND submission.processed_at >= now() - interval '7 days') AS recent,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)::text FROM weekly)
             AS median`,
        [accountId]
      );
      const loadRow = load.rows[0];

      const context: RunnerContext = {
        ...(ability ? { typicalDistanceMetres: ability.typicalDistanceMetres } : {}),
        ...(ability ? { typicalPaceSecondsPerKm: ability.typicalPaceSecondsPerKm } : {}),
        ...(loadRow?.recent ? { sevenDayActiveMinutes: Number(loadRow.recent) } : {}),
        ...(loadRow?.median ? { trailingWeeklyMedianMinutes: Number(loadRow.median) } : {})
      };
      const target = distanceTargetFor(
        {
          ...(request.query.targetDistanceKm
            ? { targetDistanceMetres: request.query.targetDistanceKm * 1_000 }
            : {}),
          ...(request.query.targetMinutes ? { targetMinutes: request.query.targetMinutes } : {})
        },
        context,
        DEFAULT_ROUTE_SUGGESTION_RULE
      );

      // Published, reviewed, still fresh, and near the coarse point. The
      // freshness filter is what `product.md`'s 30-day revalidation rule buys:
      // a route nobody has re-checked stops being offered on its own.
      const found = await database.query<RouteRow>(
        `SELECT route.id, route.name, route.family_key,
           ST_AsGeoJSON(route.path) AS path,
           ST_AsGeoJSON(route.start_point) AS start_point,
           route.distance_metres, route.surface, route.lit, route.traffic_exposure,
           route.accessibility,
           ST_Distance(route.start_point::geography,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS start_distance_metres,
           (SELECT max(event.created_at) FROM route_suggestion_events event
              WHERE event.route_id = route.id AND event.account_id = $3
                AND event.action = 'declined') AS declined_at
         FROM curated_routes route
         WHERE route.status = 'published'
           AND route.revalidate_after > now()
           AND ST_DWithin(route.start_point::geography,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)
         ORDER BY start_distance_metres
         LIMIT 50`,
        [latitude, longitude, accountId, DEFAULT_ROUTE_SUGGESTION_RULE.startWithinMetres]
      );

      const rows = new Map(found.rows.map((row) => [row.id, row]));
      const candidates: CandidateRoute[] = found.rows.map((row) => ({
        id: row.id,
        familyKey: row.family_key,
        distanceMetres: Number(row.distance_metres),
        startDistanceMetres: Number(row.start_distance_metres),
        surface: row.surface,
        lit: row.lit,
        trafficExposure: row.traffic_exposure,
        ...(row.declined_at ? { declinedAt: row.declined_at } : {})
      }));

      const ranked = rankRoutes(candidates, target, context, now, DEFAULT_ROUTE_SUGGESTION_RULE);
      const data = ranked.flatMap((entry) => {
        const row = rows.get(entry.route.id);
        if (!row) return [];
        const path = lineFromGeoJson(row.path);
        const start = pointFromGeoJson(row.start_point);
        // A loop that did not come back readable is dropped rather than drawn
        // half-way: a broken line on a map is a route somebody might follow.
        if (path.length < 4 || !start) return [];
        return [
          {
            id: row.id,
            name: row.name,
            path: path.slice(0, 512),
            start,
            distanceMetres: Number(row.distance_metres),
            startDistanceMetres: Math.round(Number(row.start_distance_metres)),
            estimatedSeconds: entry.estimatedSeconds,
            surface: row.surface,
            lit: row.lit,
            trafficExposure: row.traffic_exposure,
            accessibility: row.accessibility,
            reason: entry.reason
          }
        ];
      });

      // The impression is recorded by the server rather than reported by the
      // client: an impression a client sends is an impression a client can
      // invent, and these rows feed what gets offered next.
      for (const suggestion of data) {
        await database.query(
          `INSERT INTO route_suggestion_events (account_id, route_id, action, adjusted_to_metres)
           VALUES ($1, $2, 'shown', $3)`,
          [
            accountId,
            suggestion.id,
            target.reason === 'you_asked_for_a_distance' || target.reason === 'you_asked_for_a_time'
              ? target.targetMetres
              : null
          ]
        );
      }

      const unavailable = suggestionUnavailableReason(
        candidates,
        ranked,
        now,
        DEFAULT_ROUTE_SUGGESTION_RULE
      );
      const response: RouteSuggestionResponse = {
        data,
        targetDistanceMetres: Math.round(target.targetMetres),
        targetReason: target.reason,
        ...(data.length === 0 && unavailable ? { unavailableReason: unavailable } : {}),
        note:
          data.length === 0 && unavailable
            ? SUGGESTION_UNAVAILABLE_MESSAGE[unavailable]
            : ROUTE_SUGGESTION_NOTE
      };
      return response;
    }
  );

  /**
   * What the runner did about a suggestion.
   *
   * `declined` is the one that changes anything: it rests that loop for a
   * month (`route-suggestion.ts`), so somebody is not offered the same thing
   * they keep passing on. Nothing here records a coordinate or a pace.
   */
  routes.post<{ Params: { routeId: string }; Body: RouteSuggestionFeedbackRequest }>(
    '/v1/routes/suggestions/:routeId/feedback',
    {
      schema: {
        tags: ['routes'],
        headers: ActivityAuthorizationHeadersSchema,
        params: RouteParamsSchema,
        body: RouteSuggestionFeedbackRequestSchema,
        response: {
          200: RouteSuggestionFeedbackResponseSchema,
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

      // A route the runner was never offered is not feedback, and accepting it
      // would let anybody write rows against any published route.
      const offered = await database.query<{ route_id: string }>(
        `SELECT route_id FROM route_suggestion_events
         WHERE account_id = $1 AND route_id = $2 AND action = 'shown'
         LIMIT 1`,
        [accountId, request.params.routeId]
      );
      if (!offered.rows[0])
        return reply.code(404).send({ message: 'That route was not suggested to you' });

      await database.query(
        `INSERT INTO route_suggestion_events (account_id, route_id, action)
         VALUES ($1, $2, $3)`,
        [accountId, request.params.routeId, request.body.action]
      );
      const response: RouteSuggestionFeedbackResponse = { recorded: true };
      return response;
    }
  );
};
