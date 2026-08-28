import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { LocationSample } from './activity-recorder-core';
import { parseSyntheticNdjson, replaySamples } from './location-adapter-core';
import { activityRecorder } from './activity-recorder.native';

export const LOCATION_TASK_NAME = 'runsphere-activity-location';
export const isSyntheticLocationEnabled =
  __DEV__ && process.env.EXPO_PUBLIC_SYNTHETIC_LOCATION === 'true';

export interface LocationAdapter {
  requestLockedScreenPermission(): Promise<Location.PermissionResponse>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(onSample: (sample: LocationSample) => void): Promise<Location.LocationSubscription>;
}

const options: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 5_000,
  distanceInterval: 5,
  foregroundService: {
    notificationTitle: 'RunSphere is recording',
    notificationBody: 'Your activity location is being recorded.'
  },
  pausesUpdatesAutomatically: false
};

export const nativeLocationAdapter: LocationAdapter = {
  requestLockedScreenPermission: () => Location.requestBackgroundPermissionsAsync(),
  start: () => Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, options),
  stop: () => Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME),
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
  requestLockedScreenPermission: () =>
    Promise.resolve({
      status: 'granted',
      granted: true,
      canAskAgain: false,
      expires: 'never'
    } as Location.PermissionResponse),
  start: async () => undefined,
  stop: async () => undefined,
  subscribe: async (onSample) =>
    ({ remove: replaySamples(samples, onSample) }) as Location.LocationSubscription
});
export const syntheticLocationAdapter: LocationAdapter | undefined = isSyntheticLocationEnabled
  ? createSyntheticLocationAdapter(configuredSyntheticSamples())
  : undefined;

export const recordingLocationAdapter = syntheticLocationAdapter ?? nativeLocationAdapter;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('Activity location task failed', error.message);
    return;
  }
  const session = await activityRecorder.recoverAnyActive();
  const locations =
    (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  // Android can wake the task with a batch. Bound every write burst to protect SQLite and process death recovery.
  for (const location of locations.slice(-20)) {
    if (!session) break;
    await activityRecorder.appendSample(session.id, session.accountId, {
      recordedAt: new Date(location.timestamp).toISOString(),
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      altitude: location.coords.altitude
    });
  }
});
