import { createHash } from 'node:crypto';
import { canonicalJson, type ActivityChunkRequest } from '@runsphere/contracts';
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
export interface ValidationOutput {
  activeDurationSeconds: number;
  distanceMeters: number;
  acceptedPointCount: number;
  rejectedPointCount: number;
  rejectedGapCount: number;
}

const maximumAcceptedAccuracyMeters = 50;
const maximumContinuousGapSeconds = 60;
const maximumMovementMetersPerSecond = 25_000 / 3_600;

/**
 * Builds the activity totals from accepted validation segments. Time while paused,
 * invalid, or separated by a rejected gap never contributes to active duration.
 */
export const validateTrace = (points: TracePoint[]): ValidationOutput => {
  const accepted = points.map(
    (point) =>
      (point.accuracyMeters ?? maximumAcceptedAccuracyMeters) <= maximumAcceptedAccuracyMeters
  );
  let activeDurationSeconds = 0;
  let distance = 0;
  let rejectedGapCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1]!;
    const current = points[index]!;
    if (!accepted[index - 1] || !accepted[index]) continue;
    const seconds = (Date.parse(current.recordedAt) - Date.parse(prior.recordedAt)) / 1_000;
    const segmentDistance = distanceMeters(prior, current);
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > maximumContinuousGapSeconds ||
      segmentDistance / seconds > maximumMovementMetersPerSecond
    ) {
      rejectedGapCount += 1;
      continue;
    }
    activeDurationSeconds += seconds;
    distance += segmentDistance;
  }
  const acceptedPointCount = accepted.filter(Boolean).length;
  return {
    activeDurationSeconds,
    distanceMeters: distance,
    acceptedPointCount,
    rejectedPointCount: points.length - acceptedPointCount,
    rejectedGapCount
  };
};
export const summarize = (points: TracePoint[], validation = validateTrace(points)) => {
  return {
    distanceMeters: validation.distanceMeters,
    durationSeconds: validation.activeDurationSeconds,
    pointCount: validation.acceptedPointCount,
    rejectedPointCount: validation.rejectedPointCount,
    rejectedGapCount: validation.rejectedGapCount,
    privacyTrimmed: false
  };
};
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
  const validation = validateTrace(points);
  const summary = {
    ...summarize(points, validation),
    privacyTrimmed: keptIndexes.size !== points.length
  };
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
    `INSERT INTO activity_validation_outputs
      (activity_id, active_duration_seconds, distance_meters, accepted_point_count, rejected_point_count, rejected_gap_count, validation_algorithm_version)
     VALUES ($1, $2, $3, $4, $5, $6, 'product-core-validation-v1')
     ON CONFLICT (activity_id) DO NOTHING`,
    [
      activityId,
      Math.round(validation.activeDurationSeconds),
      validation.distanceMeters,
      validation.acceptedPointCount,
      validation.rejectedPointCount,
      validation.rejectedGapCount
    ]
  );
  await db.query(
    `UPDATE activity_submissions SET status = $1, processed_at = now(), summary = $2
     WHERE id = $3 AND status = 'validating' AND deleted_at IS NULL`,
    ['derived', JSON.stringify(summary), activityId]
  );
};
