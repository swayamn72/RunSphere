import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  RUN_LOG_PAGE_SIZE,
  RunLogQuerySchema,
  RunLogResponseSchema,
  type RunLogItem,
  type RunMode
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { routeThumbnail, trimRouteEnds } from '@runsphere/domain';
import { requireAccount } from './auth-routes.js';

/**
 * The run log (M9 9.13): counted runs, newest first, 20 a page.
 *
 * Only `derived` runs are listed. A run still uploading or being checked lives
 * on the phone, which already shows it; a run that didn't count is the
 * runner's business and never appears in a log someone else could read.
 *
 * `runLogPage` is shared with the profile run log (9.14), which passes the
 * viewer rules from the runner's privacy settings (ADR-0015). The owner's own
 * log uses `OWNER_VIEW`: start times shown, route shown, ends not trimmed.
 * Either way the route is the privacy-trimmed shareable route: zones are
 * always cut, for everyone, the owner included.
 */

export interface RunLogView {
  showStartTimes: boolean;
  showRoute: boolean;
  /** Metres cut from each end of the route, on top of privacy zones. */
  trimEndsMetres: number;
}

export const OWNER_VIEW: RunLogView = { showStartTimes: true, showRoute: true, trimEndsMetres: 0 };

interface Cursor {
  createdAt: string;
  id: string;
}

const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');

/** Undefined for a cursor this server didn't write. */
export const decodeCursor = (value: string): Cursor | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return undefined;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
};

interface RunLogRow {
  id: string;
  created_at: Date;
  started_at: Date;
  started_on: string;
  summary: { distanceMeters?: number; durationSeconds?: number } | null;
  run_mode: RunMode | null;
  moving_seconds: number | null;
  moving_pace: number | null;
  elevation_gain_meters: number | null;
  route: { type: string; coordinates: unknown } | null;
  claimed_area_sqm: number | null;
  quest_completed: boolean | null;
  quest_title: string | null;
  ghost_won: boolean | null;
}

const routeLines = (route: RunLogRow['route']): [number, number][][] | null => {
  if (!route || !Array.isArray(route.coordinates)) return null;
  if (route.type === 'MultiLineString') return route.coordinates as [number, number][][];
  if (route.type === 'LineString') return [route.coordinates as [number, number][]];
  return null;
};

const itemFrom = (row: RunLogRow, view: RunLogView): RunLogItem => {
  const distanceMeters = Number(row.summary?.distanceMeters ?? 0);
  const durationSeconds = Number(row.summary?.durationSeconds ?? 0);
  const pace =
    row.moving_pace !== null
      ? Number(row.moving_pace)
      : distanceMeters > 0
        ? Math.round((durationSeconds / distanceMeters) * 10_000) / 10
        : null;
  let lines = view.showRoute ? routeLines(row.route) : null;
  if (lines && view.trimEndsMetres > 0) lines = trimRouteEnds(lines, view.trimEndsMetres);
  const result: RunLogItem['result'] = {};
  if (row.claimed_area_sqm !== null) result.claimedAreaSqm = Number(row.claimed_area_sqm);
  if (row.run_mode === 'quest') {
    result.questCompleted = Boolean(row.quest_completed);
    if (row.quest_title) result.questTitle = row.quest_title;
  }
  if (row.run_mode === 'ghost') result.ghostWon = Boolean(row.ghost_won);
  return {
    id: row.id,
    startedOn: row.started_on,
    ...(view.showStartTimes ? { startedAt: new Date(row.started_at).toISOString() } : {}),
    distanceMeters,
    durationSeconds,
    movingSeconds: row.moving_seconds === null ? null : Number(row.moving_seconds),
    paceSecondsPerKm: pace,
    elevationGainMeters:
      row.elevation_gain_meters === null ? null : Number(row.elevation_gain_meters),
    ...(row.run_mode ? { runMode: row.run_mode } : {}),
    result,
    route: lines ? routeThumbnail(lines) : null
  };
};

export const runLogPage = async (
  database: Pick<Database, 'query'>,
  accountId: string,
  cursor: Cursor | undefined,
  view: RunLogView
): Promise<{ data: RunLogItem[]; nextCursor: string | null }> => {
  const rows = await database.query<RunLogRow>(
    `SELECT submission.id, submission.created_at,
       coalesce(submission.client_started_at, submission.created_at) AS started_at,
       to_char(coalesce(submission.client_started_at, submission.created_at)
         AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS started_on,
       submission.summary, submission.run_mode,
       metrics.moving_seconds, metrics.elevation_gain_meters,
       (metrics.metrics->>'movingPaceSecondsPerKm')::double precision AS moving_pace,
       ST_AsGeoJSON(derivation.shareable_route)::jsonb AS route,
       (SELECT claim.area_sqm FROM territory_claims claim WHERE claim.activity_id = submission.id
         ORDER BY claim.claimed_at LIMIT 1) AS claimed_area_sqm,
       EXISTS (SELECT 1 FROM quest_completions completion
         WHERE completion.activity_submission_id = submission.id) AS quest_completed,
       quest.title AS quest_title,
       EXISTS (SELECT 1 FROM territory_claims raced
         JOIN territory_claims mine ON mine.id = raced.released_to_claim_id
         WHERE raced.id = submission.ghost_claim_id AND mine.activity_id = submission.id) AS ghost_won
     FROM activity_submissions submission
     JOIN activity_derivations derivation ON derivation.activity_id = submission.id
     LEFT JOIN activity_metrics metrics ON metrics.activity_id = submission.id
     LEFT JOIN quest_versions quest ON quest.id = submission.quest_version_id
     WHERE submission.account_id = $1 AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND ($2::timestamptz IS NULL OR (submission.created_at, submission.id) < ($2::timestamptz, $3::uuid))
     ORDER BY submission.created_at DESC, submission.id DESC
     LIMIT $4`,
    [accountId, cursor?.createdAt ?? null, cursor?.id ?? null, RUN_LOG_PAGE_SIZE + 1]
  );
  const page = rows.rows.slice(0, RUN_LOG_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    data: page.map((row) => itemFrom(row, view)),
    nextCursor:
      rows.rows.length > RUN_LOG_PAGE_SIZE && last
        ? encodeCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.id })
        : null
  };
};

export const registerRunLogRoutes = ({
  routes,
  database,
  authSecret
}: {
  routes: FastifyInstance;
  database?: Database | undefined;
  authSecret: string;
}): void => {
  routes.get<{ Querystring: { cursor?: string } }>(
    '/v1/runs',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        querystring: RunLogQuerySchema,
        response: {
          200: RunLogResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : undefined;
      if (request.query.cursor && !cursor)
        return reply.code(400).send({ message: 'That page link has expired. Reload your runs.' });
      return runLogPage(database, accountId, cursor, OWNER_VIEW);
    }
  );
};
