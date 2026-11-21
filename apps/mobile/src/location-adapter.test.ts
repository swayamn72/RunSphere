import { describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({
  watchPositionAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(async () => undefined),
  stopLocationUpdatesAsync: vi.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: vi.fn(async () => false)
}));

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock('expo-location', () => ({
  Accuracy: { High: 5 },
  ActivityType: { Fitness: 3 },
  ...location
}));

import {
  RUN_LOCATION_TASK,
  createSyntheticLocationAdapter,
  markRunLocationTaskReady,
  nativeLocationAdapter,
  publishRunLocations,
  screenOffLocationAdapter
} from './location-adapter.js';
import { parseSyntheticNdjson } from './location-adapter-core.js';

describe('foreground location adapter', () => {
  it('accepts deterministic NDJSON and rejects malformed fixture records', () => {
    expect(
      parseSyntheticNdjson(
        '{"recordedAt":"2026-08-28T06:00:00Z","latitude":19.076,"longitude":72.877,"accuracy":8}\n'
      )
    ).toEqual([
      {
        recordedAt: '2026-08-28T06:00:00Z',
        latitude: 19.076,
        longitude: 72.877,
        accuracy: 8,
        altitude: null
      }
    ]);
    expect(() => parseSyntheticNdjson('{"latitude":19}\n')).toThrow('synthetic location fixture');
  });

  it('uses only foreground watcher registration', async () => {
    const callback = vi.fn();
    location.watchPositionAsync.mockResolvedValue({ remove: vi.fn() });
    await nativeLocationAdapter.subscribe(callback);
    expect(location.watchPositionAsync).toHaveBeenCalledOnce();
  });

  it('replays synthetic fixes through the same subscription seam', async () => {
    // Fake timers, because `replaySamples` emits on a 500 ms `setInterval`.
    // This test used to wait `setTimeout(0)` and then remove the subscription,
    // which cleared the interval before its first tick — so it asserted one
    // call and got zero, every time. It was not flaky; it was wrong.
    vi.useFakeTimers();
    try {
      const onSample = vi.fn();
      const adapter = createSyntheticLocationAdapter([
        {
          recordedAt: '2026-08-28T06:00:00Z',
          latitude: 19,
          longitude: 72,
          accuracy: 8,
          altitude: null
        }
      ]);
      const subscription = await adapter.subscribe(onSample);

      await vi.advanceTimersByTimeAsync(500);
      expect(onSample).toHaveBeenCalledTimes(1);
      expect(onSample).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 19, longitude: 72 })
      );

      // The replay stops when the fixture runs out rather than looping.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(onSample).toHaveBeenCalledTimes(1);
      subscription.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops emitting once the subscription is removed', async () => {
    vi.useFakeTimers();
    try {
      const onSample = vi.fn();
      const adapter = createSyntheticLocationAdapter([
        {
          recordedAt: '2026-08-28T06:00:00Z',
          latitude: 19,
          longitude: 72,
          accuracy: 8,
          altitude: null
        },
        {
          recordedAt: '2026-08-28T06:00:05Z',
          latitude: 19.001,
          longitude: 72,
          accuracy: 8,
          altitude: null
        }
      ]);
      const subscription = await adapter.subscribe(onSample);

      await vi.advanceTimersByTimeAsync(500);
      subscription.remove();
      await vi.advanceTimersByTimeAsync(5_000);

      // The second fixture never arrives: a removed subscription is removed.
      expect(onSample).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('screen-off run recording (M8 C.3)', () => {
  const fix = (second: number) => ({
    timestamp: Date.UTC(2026, 10, 22, 6, 0, second),
    coords: { latitude: 19.07, longitude: 72.87, accuracy: 6, altitude: 9 }
  });

  it('records on screen only until the run task exists', async () => {
    location.watchPositionAsync.mockResolvedValueOnce({ remove: vi.fn() });
    await screenOffLocationAdapter.subscribe(() => undefined);
    expect(location.watchPositionAsync).toHaveBeenCalled();
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('stops a service left over from a killed run when nothing is recording', async () => {
    location.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
    markRunLocationTaskReady();
    await vi.waitFor(() =>
      expect(location.stopLocationUpdatesAsync).toHaveBeenCalledWith(RUN_LOCATION_TASK)
    );
  });

  it('runs a location foreground service with a visible notification for the run', async () => {
    const seen: string[] = [];
    const subscription = await screenOffLocationAdapter.subscribe((sample) =>
      seen.push(sample.recordedAt)
    );

    expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      RUN_LOCATION_TASK,
      expect.objectContaining({
        foregroundService: expect.objectContaining({
          notificationTitle: 'Recording your run',
          killServiceOnDestroy: true
        })
      })
    );

    publishRunLocations([fix(1), fix(2)] as never);
    expect(seen).toEqual([
      new Date(fix(1).timestamp).toISOString(),
      new Date(fix(2).timestamp).toISOString()
    ]);

    location.stopLocationUpdatesAsync.mockClear();
    location.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
    subscription.remove();
    await vi.waitFor(() => expect(location.stopLocationUpdatesAsync).toHaveBeenCalled());
  });

  it('falls back to on-screen recording when Android refuses the service', async () => {
    location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('not allowed'));
    location.watchPositionAsync.mockClear();
    location.watchPositionAsync.mockResolvedValueOnce({ remove: vi.fn() });

    await screenOffLocationAdapter.subscribe(() => undefined);

    expect(location.watchPositionAsync).toHaveBeenCalled();
  });
});
