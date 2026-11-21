import * as Location from 'expo-location';
import type { LocationSample } from './activity-recorder-core';
import { parseSyntheticNdjson, replaySamples } from './location-adapter-core';
import { createSharedLocationUpdates } from './shared-location-updates';

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

const toLocationSample = (location: Location.LocationObject): LocationSample => ({
  recordedAt: new Date(location.timestamp).toISOString(),
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  accuracy: location.coords.accuracy,
  altitude: location.coords.altitude
});

/** On-screen updates only: Android throttles these once the screen locks. */
export const nativeLocationAdapter: LocationAdapter = {
  subscribe: async (onSample) =>
    Location.watchPositionAsync(options, (location) => onSample(toLocationSample(location)))
};

/**
 * Screen-off recording (M8 C.3). A run's samples come from a location
 * foreground service: Android shows this notification for as long as the run
 * is recording, and the service ends when the run is paused or finished, or
 * when the app is swiped away. Starting it from the Start tap is what lets it
 * run without ACCESS_BACKGROUND_LOCATION.
 */
export const RUN_LOCATION_TASK = 'runsphere-run-location';
export const RUN_SERVICE_NOTIFICATION = {
  notificationTitle: 'Recording your run',
  notificationBody: 'RunSphere is recording your route. Pause or finish in the app to stop.',
  killServiceOnDestroy: true
} as const;

const runLocationUpdates = createSharedLocationUpdates({
  start: () =>
    Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      ...options,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      foregroundService: RUN_SERVICE_NOTIFICATION
    }),
  stop: async () => {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
  }
});

let runLocationTaskReady = false;

/**
 * Called by the TaskManager task in `App.tsx` with each batch Android delivers.
 * Locations that arrive with no run listening are dropped, never stored.
 */
export const publishRunLocations = (locations: readonly Location.LocationObject[]): void =>
  runLocationUpdates.publish(locations.map(toLocationSample));

/**
 * `App.tsx` calls this once its task is defined. TaskManager remembers
 * registered tasks across launches, so a service left over from a run the
 * system killed is stopped here unless a run has already resubscribed.
 */
export const markRunLocationTaskReady = (): void => {
  runLocationTaskReady = true;
  void (async () => {
    if (runLocationUpdates.listenerCount > 0) return;
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
  })().catch(() => undefined);
};

/**
 * Records with the screen off when it can. A build without TaskManager, or a
 * service Android refuses to start, falls back to on-screen updates, so the run
 * still records while the app is open rather than not at all.
 */
export const screenOffLocationAdapter: LocationAdapter = {
  subscribe: async (onSample) => {
    if (!runLocationTaskReady) return nativeLocationAdapter.subscribe(onSample);
    try {
      return (await runLocationUpdates.subscribe(onSample)) as Location.LocationSubscription;
    } catch {
      return nativeLocationAdapter.subscribe(onSample);
    }
  }
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

const syntheticIntervalMs = Number(process.env.EXPO_PUBLIC_SYNTHETIC_INTERVAL_MS || 480);

export const createSyntheticLocationAdapter = (
  samples: readonly LocationSample[],
  intervalMs = syntheticIntervalMs
): LocationAdapter => ({
  subscribe: async (onSample) =>
    ({ remove: replaySamples(samples, onSample, intervalMs) }) as Location.LocationSubscription
});

export const syntheticLocationAdapter: LocationAdapter | undefined = isSyntheticLocationEnabled
  ? createSyntheticLocationAdapter(configuredSyntheticSamples())
  : undefined;

/** GPS warm-up before a run starts: the screen is on, so on-screen updates are enough. */
export const recordingLocationAdapter = syntheticLocationAdapter ?? nativeLocationAdapter;
/** The run itself, which has to keep recording when the runner locks the phone. */
export const runRecordingLocationAdapter = syntheticLocationAdapter ?? screenOffLocationAdapter;
