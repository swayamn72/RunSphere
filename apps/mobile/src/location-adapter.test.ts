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
    await new Promise((resolve) => setTimeout(resolve, 0));
    subscription.remove();
    expect(onSample).toHaveBeenCalledTimes(1);
  });
});
