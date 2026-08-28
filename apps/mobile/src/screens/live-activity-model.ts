import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';
import type {
  ActivitySession,
  RecordedLocationSample,
  RecordingState
} from '../activity-recorder-core';

export type LiveGpsState = 'acquiring' | 'strong' | 'weak' | 'gap' | 'recovered' | 'paused';

export interface LiveGpsStatus {
  readonly state: LiveGpsState;
  readonly lastUsableAt?: string;
  readonly message: string;
}

const usable = (sample: RecordedLocationSample): boolean =>
  sample.disposition === 'usable' ||
  sample.disposition === 'gap-anchor' ||
  sample.disposition === 'resume-anchor';

const coordinate = (sample: RecordedLocationSample): Position => [
  sample.longitude,
  sample.latitude
];

/**
 * Builds renderer-local geometry only. A fresh anchor starts a new path, so private
 * observations that are weak, impossible, paused, or separated by a gap never bridge.
 */
export const liveRouteGeometry = (
  samples: readonly RecordedLocationSample[]
): Geometry | undefined => {
  const paths: Position[][] = [];
  let path: Position[] | undefined;

  for (const sample of samples) {
    if (!usable(sample)) {
      path = undefined;
      continue;
    }
    if (
      sample.disposition === 'gap-anchor' ||
      sample.disposition === 'resume-anchor' ||
      sample.segmentBreak ||
      !path
    ) {
      path = [coordinate(sample)];
      paths.push(path);
      continue;
    }
    path.push(coordinate(sample));
  }

  const lines = paths.filter((item) => item.length >= 2);
  if (!lines.length) return undefined;
  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0]! }
    : { type: 'MultiLineString', coordinates: lines };
};

export const liveRouteLayers = (
  samples: readonly RecordedLocationSample[]
): readonly LocalGeoJsonLayer[] => {
  const geometry = liveRouteGeometry(samples);
  if (!geometry) return [];
  const data: FeatureCollection<Geometry, GeoJsonProperties> = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry }]
  };
  return [{ id: 'private-live-route', kind: 'line', data }];
};

export const latestUsableSample = (
  samples: readonly RecordedLocationSample[]
): RecordedLocationSample | undefined => [...samples].reverse().find(usable);

export const classifyLiveGps = ({
  state,
  samples,
  now
}: {
  readonly state: RecordingState;
  readonly samples: readonly RecordedLocationSample[];
  readonly now: number;
}): LiveGpsStatus => {
  if (state === 'paused')
    return {
      state: 'paused',
      message: 'Activity paused. Resume when you are ready to record again.'
    };

  const latest = samples.at(-1);
  const lastUsable = latestUsableSample(samples);
  if (!lastUsable)
    return {
      state: 'acquiring',
      message: 'Looking for a clear GPS fix. Provisional distance starts after a usable fix.'
    };

  const elapsed = Math.max(0, now - Date.parse(lastUsable.recordedAt));
  if (elapsed > 60_000)
    return {
      state: 'gap',
      lastUsableAt: lastUsable.recordedAt,
      message:
        'GPS has been unavailable for over a minute. Route and distance contribution are paused until it recovers.'
    };
  if (latest && !usable(latest))
    return {
      state: 'weak',
      lastUsableAt: lastUsable.recordedAt,
      message:
        'GPS is weak. This observation is saved privately but is not adding to provisional distance.'
    };
  if (latest?.disposition === 'gap-anchor')
    return {
      state: 'recovered',
      lastUsableAt: latest.recordedAt,
      message: 'GPS recovered. A new private route segment has started without filling the gap.'
    };
  return { state: 'strong', lastUsableAt: lastUsable.recordedAt, message: 'GPS is clear.' };
};

export const formatProvisionalDistance = (meters: number): string =>
  `${(meters / 1_000).toFixed(2)} km`;

export const formatProvisionalDuration = (seconds: number): string =>
  `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

export const formatLastClear = (recordedAt: string | undefined, now: number): string => {
  if (!recordedAt) return 'No clear fix yet';
  const seconds = Math.max(0, Math.floor((now - Date.parse(recordedAt)) / 1_000));
  return seconds < 60
    ? `Last clear fix ${seconds}s ago`
    : `Last clear fix ${Math.floor(seconds / 60)}m ago`;
};

export const provisionalPace = (
  session: Pick<ActivitySession, 'distanceMeters' | 'durationSeconds'>
): string =>
  session.distanceMeters > 0
    ? (() => {
        const seconds = Math.round(session.durationSeconds / (session.distanceMeters / 1_000));
        return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
      })()
    : '—';
