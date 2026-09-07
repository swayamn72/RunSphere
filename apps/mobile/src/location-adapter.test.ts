import { describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ watchPositionAsync: vi.fn() }));

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock('expo-location', () => ({
  Accuracy: { High: 5 },
  ...location
}));

import { createSyntheticLocationAdapter, nativeLocationAdapter } from './location-adapter.js';
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
