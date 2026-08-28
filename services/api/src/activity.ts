import { createHash } from 'node:crypto';
import type { ActivityChunkRequest } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';

export interface TracePoint {
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyMeters?: number;
}
interface ZoneProvenance {
  id: string;
  geometry_version: number;
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};
export const chunkHash = (chunk: ActivityChunkRequest) =>
  createHash('sha256').update(canonicalJson(chunk)).digest('hex');
const radians = (degrees: number) => degrees * (Math.PI / 180);
export const distanceMeters = (a: TracePoint, b: TracePoint) => {
  const earth = 6_371_000;
  const lat = radians(b.latitude - a.latitude);
  const lon = radians(b.longitude - a.longitude);
  const x =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(x));
};
export const summarize = (points: TracePoint[]) => ({
  distanceMeters: points
    .slice(1)
    .reduce((sum, point, index) => sum + distanceMeters(points[index]!, point), 0),
  durationSeconds:
    points.length > 1
      ? Math.max(
          0,
          (Date.parse(points.at(-1)!.recordedAt) - Date.parse(points[0]!.recordedAt)) / 1000
        )
      : 0,
  pointCount: points.length,
  privacyTrimmed: false
});
export const loadPoints = async (db: Database, activityId: string): Promise<TracePoint[]> => {
  const chunks = await db.query<{ payload: ActivityChunkRequest }>(
    'SELECT payload FROM activity_chunks WHERE activity_id = $1 ORDER BY sequence',
    [activityId]
  );
  return chunks.rows.flatMap((chunk) => chunk.payload.points);
};

export const processActivity = async (db: Database, activityId: string): Promise<void> => {
  const activity = await db.query<{ account_id: string; source_checksum: string }>(
    `SELECT account_id, source_checksum FROM activity_submissions
     WHERE id = $1 AND status = $2 AND deleted_at IS NULL`,
    [activityId, 'validating']
  );
  if (!activity.rows[0]) return;
  const points = await loadPoints(db, activityId);
  if (points.length === 0) return;
  const candidate = JSON.stringify({
    type: 'MultiPoint',
    coordinates: points.map((point) => [point.longitude, point.latitude])
  });
  const trim = await db.query<{ kept_indexes: number[]; applied_zones: ZoneProvenance[] }>(
    `WITH input AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS points),
      numbered AS (SELECT dumped.geom AS point, row_number() OVER () - 1 AS point_index FROM input CROSS JOIN LATERAL ST_DumpPoints(points) AS dumped),
      removed AS (
        SELECT numbered.point_index, zone.id, zone.geometry_version
        FROM numbered JOIN privacy_zones zone ON zone.account_id = $2
        WHERE ST_DWithin(numbered.point::geography, zone.geometry::geography, 200)
      )
      SELECT coalesce(array_agg(numbered.point_index ORDER BY numbered.point_index) FILTER (WHERE removed.point_index IS NULL), ARRAY[]::integer[]) AS kept_indexes,
        coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', removed.id, 'geometryVersion', removed.geometry_version)) FILTER (WHERE removed.id IS NOT NULL), '[]'::jsonb) AS applied_zones
      FROM numbered LEFT JOIN removed ON removed.point_index = numbered.point_index`,
    [candidate, activity.rows[0].account_id]
  );
  const rawIndexes = trim.rows[0]?.kept_indexes ?? [];
  const indexes = Array.isArray(rawIndexes)
    ? rawIndexes
    : String(rawIndexes).replace(/[{}]/g, '').split(',').filter(Boolean);
  const keptIndexes = new Set(indexes.map(Number));
  const segments: TracePoint[][] = [];
  let current: TracePoint[] = [];
  for (const [index, point] of points.entries()) {
    if (keptIndexes.has(index)) current.push(point);
    else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  const routeSegments = segments.filter((segment) => segment.length >= 2);
  const route = routeSegments.length
    ? JSON.stringify({
        type: 'MultiLineString',
        coordinates: routeSegments.map((segment) =>
          segment.map((point) => [point.longitude, point.latitude])
        )
      })
    : null;
  const appliedZones = trim.rows[0]?.applied_zones ?? [];
  const summary = { ...summarize(points), privacyTrimmed: keptIndexes.size !== points.length };
  await db.query(
    `INSERT INTO activity_derivations (activity_id, shareable_route, source_checksum, route_checksum, policy_version, algorithm_version, applied_zone_ids, applied_zones, removed_point_count, outcome)
     SELECT $1, CASE WHEN $2::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) END,
       $3, $4, 'm2-privacy-200m', 'm2-canonical-v1', $5::uuid[], $6::jsonb, $7, $8
     WHERE EXISTS (SELECT 1 FROM activity_submissions WHERE id = $1 AND status = 'validating' AND deleted_at IS NULL)
     ON CONFLICT (activity_id) DO NOTHING`,
    [
      activityId,
      route,
      activity.rows[0].source_checksum,
      createHash('sha256')
        .update(route ?? '')
        .digest('hex'),
      appliedZones.map((zone) => zone.id),
      JSON.stringify(appliedZones),
      points.length - keptIndexes.size,
      route ? 'trimmed' : 'no-shareable-route'
    ]
  );
  await db.query(
    `UPDATE activity_submissions SET status = $1, processed_at = now(), summary = $2
     WHERE id = $3 AND status = 'validating' AND deleted_at IS NULL`,
    ['derived', JSON.stringify(summary), activityId]
  );
};
