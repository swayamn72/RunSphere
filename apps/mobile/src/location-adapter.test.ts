import { describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({
  hasStartedLocationUpdatesAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  watchPositionAsync: vi.fn()
}));

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock('expo-location', () => ({
  Accuracy: { High: 5 },
  ...location
}));
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));
vi.mock('./activity-recorder.native', () => ({ activityRecorder: {} }));

import { nativeLocationAdapter, persistBackgroundLocations } from './location-adapter.js';
import { parseSyntheticNdjson } from './location-adapter-core.js';

describe('synthetic location fixture seam', () => {
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
});

describe('background location persistence', () => {
  it('initializes encrypted storage before recovering and persists every Android batch location', async () => {
    const calls: string[] = [];
    const recorder = {
      initialize: vi.fn(async () => calls.push('initialize')),
      recoverAnyActive: vi.fn(async () => {
        calls.push('recover');
        return { id: 'activity-1', accountId: 'account-1' };
      }),
      appendSample: vi.fn(async () => calls.push('append'))
    };
    await persistBackgroundLocations(
      {
        locations: [
          {
            timestamp: 1,
            coords: { latitude: 19.07, longitude: 72.87, accuracy: 8, altitude: null }
          },
          {
            timestamp: 2,
            coords: { latitude: 19.08, longitude: 72.88, accuracy: 9, altitude: 2 }
          }
        ]
      } as never,
      recorder as never
    );

    expect(calls).toEqual(['initialize', 'recover', 'append', 'append']);
    expect(recorder.appendSample).toHaveBeenCalledTimes(2);
  });

  it('does not stop an unregistered background task', async () => {
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await nativeLocationAdapter.stopBackground();
    expect(location.stopLocationUpdatesAsync).not.toHaveBeenCalled();

    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await nativeLocationAdapter.stopBackground();
    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledOnce();
  });
});
