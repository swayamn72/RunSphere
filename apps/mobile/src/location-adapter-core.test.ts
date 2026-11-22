import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationSample } from './activity-recorder-core.js';
import { replaySamples } from './location-adapter-core.js';

const at = (iso: string, latitude: number): LocationSample => ({
  recordedAt: iso,
  latitude,
  longitude: 72,
  accuracy: 8,
  altitude: null
});

afterEach(() => vi.useRealTimers());

describe('synthetic replay (dev only)', () => {
  it('keeps the track’s own spacing, so a 10 s-apart track is not read as twice as fast', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-22T06:00:00.000Z'));
    const emitted: LocationSample[] = [];
    replaySamples(
      [
        at('2026-09-11T04:30:00.000Z', 19),
        at('2026-09-11T04:30:10.000Z', 19.0004),
        at('2026-09-11T04:30:20.000Z', 19.0008)
      ],
      (sample) => emitted.push(sample)
    );
    vi.advanceTimersByTime(1_600);
    expect(emitted.map((sample) => sample.recordedAt)).toEqual([
      '2026-11-22T06:00:00.000Z',
      '2026-11-22T06:00:10.000Z',
      '2026-11-22T06:00:20.000Z'
    ]);
  });

  it('falls back to 5 s steps when the track has no usable times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-22T06:00:00.000Z'));
    const emitted: LocationSample[] = [];
    replaySamples([at('nope', 19), at('nope', 19.0004)], (sample) => emitted.push(sample));
    vi.advanceTimersByTime(1_100);
    expect(emitted.map((sample) => sample.recordedAt)).toEqual([
      '2026-11-22T06:00:00.000Z',
      '2026-11-22T06:00:05.000Z'
    ]);
  });
});
