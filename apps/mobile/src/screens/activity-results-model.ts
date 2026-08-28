import type { ActivityDetailResponse, ActivityLifecycleStatus } from '@runsphere/contracts';
import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { ActivitySession } from '../activity-recorder-core';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';

export type SyncActivityStatus = ActivityLifecycleStatus;

export const isKnownRemoteStatus = (status: unknown): status is SyncActivityStatus =>
  ['received', 'validating', 'accepted', 'rejected', 'derived', 'deleted'].includes(
    status as string
  );
export type ActivityResultDetail = Omit<ActivityDetailResponse, 'id'> & { readonly id?: string };

export type ActivityResultPresentation =
  | { readonly state: 'validated'; readonly detail: ActivityResultDetail }
  | { readonly state: 'rejected'; readonly detail?: ActivityResultDetail }
  | { readonly state: 'deleted' }
  | { readonly state: 'pending' };

/** A cached lifecycle status never validates totals, but terminal outcomes must remain truthful offline. */
export const activityResultPresentation = (
  detail: ActivityResultDetail | undefined,
  remoteStatus?: ActivityLifecycleStatus
): ActivityResultPresentation => {
  if (detail?.status === 'derived' && detail.summary) return { state: 'validated', detail };
  if (detail?.status === 'rejected') return { state: 'rejected', detail };
  if (detail?.status === 'deleted' || remoteStatus === 'deleted') return { state: 'deleted' };
  if (remoteStatus === 'rejected') return { state: 'rejected' };
  return { state: 'pending' };
};

export const activityHistoryMetric = (
  session: Pick<ActivitySession, 'distanceMeters' | 'remoteStatus'>,
  fetchedDetail: ActivityResultDetail | undefined
): { readonly distanceMeters: number; readonly detail: string } => {
  if (fetchedDetail?.status === 'derived' && fetchedDetail.summary)
    return { distanceMeters: fetchedDetail.summary.distanceMeters, detail: 'Validated distance' };
  return { distanceMeters: session.distanceMeters, detail: 'Provisional local distance' };
};

const validPosition = (position: unknown): position is Position =>
  Array.isArray(position) &&
  position.length >= 2 &&
  position.every(
    (value, index) => index > 1 || (typeof value === 'number' && Number.isFinite(value))
  );

const validLine = (line: unknown): line is Position[] =>
  Array.isArray(line) && line.length >= 2 && line.every(validPosition);

export const validDerivedRouteGeometry = (geometry: unknown): Geometry | undefined => {
  if (!geometry || typeof geometry !== 'object') return undefined;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type === 'LineString' && validLine(candidate.coordinates))
    return { type: 'LineString', coordinates: candidate.coordinates };
  if (
    candidate.type === 'MultiLineString' &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(validLine)
  )
    return { type: 'MultiLineString', coordinates: candidate.coordinates };
  return undefined;
};

/** A route layer can be created only from a valid fetched derived-detail response. */
export const derivedResultRouteLayers = (
  presentation: ActivityResultPresentation
): readonly LocalGeoJsonLayer[] => {
  if (presentation.state !== 'validated') return [];
  const geometry = validDerivedRouteGeometry(presentation.detail.geometry);
  if (!geometry) return [];
  const data: FeatureCollection<Geometry, GeoJsonProperties> = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry }]
  };
  return [{ id: 'server-derived-result-route', kind: 'line', data }];
};

const RESULT_CENTER_SAMPLE_LIMIT = 1_024;

/**
 * Reduces untrusted derived geometry before calculating a center so a malformed
 * large result cannot create an unbounded spread/allocation in the render path.
 */
export const derivedRouteCenter = (geometry: Geometry): [number, number] | undefined => {
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
  let minimumLongitude = Infinity;
  let maximumLongitude = -Infinity;
  let minimumLatitude = Infinity;
  let maximumLatitude = -Infinity;
  let sampled = 0;
  for (const line of lines) {
    const stride = Math.max(1, Math.ceil(line.length / RESULT_CENTER_SAMPLE_LIMIT));
    const include = (coordinate: Position | undefined) => {
      if (!coordinate || sampled >= RESULT_CENTER_SAMPLE_LIMIT) return;
      const [longitude, latitude] = coordinate;
      if (longitude === undefined || latitude === undefined) return;
      minimumLongitude = Math.min(minimumLongitude, longitude);
      maximumLongitude = Math.max(maximumLongitude, longitude);
      minimumLatitude = Math.min(minimumLatitude, latitude);
      maximumLatitude = Math.max(maximumLatitude, latitude);
      sampled += 1;
    };
    for (
      let index = 0;
      index < line.length && sampled < RESULT_CENTER_SAMPLE_LIMIT - 1;
      index += stride
    )
      include(line[index]);
    // Include the final vertex so a bounded reduction still represents route extent.
    include(line.at(-1));
    if (sampled >= RESULT_CENTER_SAMPLE_LIMIT) break;
  }
  if (!sampled) return undefined;
  return [(minimumLongitude + maximumLongitude) / 2, (minimumLatitude + maximumLatitude) / 2];
};

export const calculatedPace = (
  summary: Pick<NonNullable<ActivityResultDetail['summary']>, 'distanceMeters' | 'durationSeconds'>
): string => {
  if (summary.distanceMeters <= 0) return '—';
  const seconds = Math.round(summary.durationSeconds / (summary.distanceMeters / 1_000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
};

export const activityHistoryLabel = (remoteStatus: ActivityLifecycleStatus | undefined): string => {
  if (remoteStatus === 'derived') return 'Validated totals refresh when connected';
  if (remoteStatus === 'rejected') return 'Saved privately — not eligible for validated totals';
  if (remoteStatus === 'deleted') return 'Deleted on RunSphere';
  return 'Pending server validation';
};
