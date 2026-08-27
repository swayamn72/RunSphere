import { createHash } from 'node:crypto';
import type { ActivityChunkRequest } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';

export interface TracePoint {
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyMeters?: number;
}

export const chunkHash = (chunk: ActivityChunkRequest) =>
  createHash('sha256').update(JSON.stringify(chunk)).digest('hex');
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

const trimEndpoint = (points: TracePoint[], fromEnd = false): TracePoint[] => {
  const ordered = fromEnd ? [...points].reverse() : points;
  let covered = 0;
  let index = 0;
  while (index + 1 < ordered.length && covered < 200) {
    covered += distanceMeters(ordered[index]!, ordered[index + 1]!);
    index += 1;
  }
  const result = ordered.slice(index);
  return fromEnd ? result.reverse() : result;
};

export const processActivity = async (db: Database, activityId: string): Promise<void> => {
  const activity = await db.query<{ account_id: string; source_checksum: string }>(
    'SELECT account_id, source_checksum FROM activity_submissions WHERE id = $1 AND status = $2',
    [activityId, 'validating']
  );
  if (!activity.rows[0]) return;
  const points = await loadPoints(db, activityId);
  const zones = await db.query<{ id: string }>(
    'SELECT id FROM privacy_zones WHERE account_id = $1',
    [activity.rows[0].account_id]
  );
  const withoutEndpoints = trimEndpoint(trimEndpoint(points), true);
  const kept: TracePoint[] = [];
  for (const point of withoutEndpoints) {
    const inside = await db.query<{ id: string }>(
      'SELECT id FROM privacy_zones WHERE account_id = $1 AND ST_Intersects(geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326)) LIMIT 1',
      [activity.rows[0].account_id, point.longitude, point.latitude]
    );
    if (inside.rows.length === 0) kept.push(point);
  }
  const route =
    kept.length >= 2
      ? JSON.stringify({
          type: 'LineString',
          coordinates: kept.map((point) => [point.longitude, point.latitude])
        })
      : null;
  const summary = { ...summarize(points), privacyTrimmed: points.length !== kept.length };
  await db.query(
    `INSERT INTO activity_derivations (activity_id, shareable_route, source_checksum, route_checksum, policy_version, algorithm_version, applied_zone_ids, removed_point_count, outcome)
     VALUES ($1, CASE WHEN $2::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) END, $3, $4, 'm1-privacy-200m', 'm1-canonical-v1', $5::uuid[], $6, $7)
     ON CONFLICT (activity_id) DO NOTHING`,
    [
      activityId,
      route,
      activity.rows[0].source_checksum,
      createHash('sha256')
        .update(route ?? '')
        .digest('hex'),
      zones.rows.map((zone) => zone.id),
      points.length - kept.length,
      route ? 'trimmed' : 'no-shareable-route'
    ]
  );
  await db.query(
    'UPDATE activity_submissions SET status = $1, processed_at = now(), summary = $2 WHERE id = $3',
    ['derived', JSON.stringify(summary), activityId]
  );
};
