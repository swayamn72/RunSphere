import * as Location from 'expo-location';
import type { LocationSample } from './activity-recorder-core';
import { parseSyntheticNdjson, replaySamples } from './location-adapter-core';

export const isSyntheticLocationEnabled =
  __DEV__ && process.env.EXPO_PUBLIC_SYNTHETIC_LOCATION === 'true';

export interface LocationAdapter {
  subscribe(onSample: (sample: LocationSample) => void): Promise<Location.LocationSubscription>;
}

const options: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 5_000,
  distanceInterval: 5
};

export const nativeLocationAdapter: LocationAdapter = {
  subscribe: async (onSample) =>
    Location.watchPositionAsync(options, (location) =>
      onSample({
        recordedAt: new Date(location.timestamp).toISOString(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude
      })
    )
};

/** Dev-only seam accepts injected deterministic location arrays or NDJSON; production has no synthetic provider. */
const configuredSyntheticSamples = (): LocationSample[] => {
  if (!isSyntheticLocationEnabled) return [];
  const source = process.env.EXPO_PUBLIC_SYNTHETIC_LOCATION_NDJSON;
  return source
    ? parseSyntheticNdjson(source)
    : [
        {
          recordedAt: '2026-08-28T06:00:00.000Z',
          latitude: 19.076,
          longitude: 72.8777,
          accuracy: 8,
          altitude: 12
        }
      ];
};

export const createSyntheticLocationAdapter = (
  samples: readonly LocationSample[]
): LocationAdapter => ({
  subscribe: async (onSample) =>
    ({ remove: replaySamples(samples, onSample) }) as Location.LocationSubscription
});

export const syntheticLocationAdapter: LocationAdapter | undefined = isSyntheticLocationEnabled
  ? createSyntheticLocationAdapter(configuredSyntheticSamples())
  : undefined;

export const recordingLocationAdapter = syntheticLocationAdapter ?? nativeLocationAdapter;
