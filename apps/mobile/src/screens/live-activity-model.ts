import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';
import { DEFAULT_CLAIM_RULE, haversineMetres, ringAreaSqm } from '@runsphere/domain';
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

export const liveLoopFeedback = (samples: readonly RecordedLocationSample[]) => {
  let start = samples.length;
  while (start > 0) {
    const sample = samples[start - 1]!;
    if (!usable(sample)) break;
    start -= 1;
    if (sample.segmentBreak || sample.disposition !== 'usable') break;
  }
  const segment = samples.slice(start);
  const first = segment[0];
  const last = segment.at(-1);
  if (!first || !last || segment.length < 4) return undefined;
  const area = ringAreaSqm(segment.map(({ longitude, latitude }) => [longitude, latitude]));
  if (area < DEFAULT_CLAIM_RULE.minAreaSqm || area > DEFAULT_CLAIM_RULE.maxAreaSqm)
    return undefined;
  const gap = haversineMetres(first, last);
  const ready =
    gap <= DEFAULT_CLAIM_RULE.closeWithinMetres &&
    Date.parse(last.recordedAt) > Date.parse(first.recordedAt);
  const layer: LocalGeoJsonLayer = {
    id: 'private-loop-return',
    kind: ready ? 'loop-ready' : 'loop-return',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [coordinate(last), coordinate(first)] }
        }
      ]
    }
  };
  return { layer, ready, gap };
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
      message: "Run paused. Resume when you're ready."
    };

  const latest = samples.at(-1);
  const lastUsable = latestUsableSample(samples);
  if (!lastUsable)
    return {
      state: 'acquiring',
      message: 'Finding GPS. Distance starts once the signal is clear.'
    };

  const elapsed = Math.max(0, now - Date.parse(lastUsable.recordedAt));
  if (elapsed > 60_000)
    return {
      state: 'gap',
      lastUsableAt: lastUsable.recordedAt,
      message: 'GPS lost. Keep running; distance resumes when signal is back.'
    };
  if (latest && !usable(latest))
    return {
      state: 'weak',
      lastUsableAt: lastUsable.recordedAt,
      message: "GPS is weak. Keep going; this stretch won't add distance."
    };
  if (latest?.disposition === 'gap-anchor')
    return {
      state: 'recovered',
      lastUsableAt: latest.recordedAt,
      message: 'GPS is back. Your route picks up from here.'
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
