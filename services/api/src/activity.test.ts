import { describe, expect, it } from 'vitest';
import {
  distanceMeters,
  chunkHash,
  summarize,
  validateTrace,
  type TracePoint
} from './activity.js';

const points: TracePoint[] = [
  { latitude: 19.076, longitude: 72.8777, recordedAt: '2026-08-27T10:00:00.000Z' },
  { latitude: 19.077, longitude: 72.8787, recordedAt: '2026-08-27T10:01:00.000Z' }
];

describe('canonical activity summaries', () => {
  it('calculates geodesic distance and duration from submitted points', () => {
    expect(distanceMeters(points[0]!, points[1]!)).toBeGreaterThan(100);
    expect(summarize(points)).toMatchObject({
      pointCount: 2,
      durationSeconds: 60,
      privacyTrimmed: false
    });
  });

  it('reuses a supplied validation result when creating the authoritative summary', () => {
    const validation = {
      activeDurationSeconds: 42,
      distanceMeters: 123,
      acceptedPointCount: 2,
      rejectedPointCount: 0,
      rejectedGapCount: 0
    };
    expect(summarize(points, validation)).toMatchObject({
      distanceMeters: 123,
      durationSeconds: 42,
      pointCount: 2
    });
  });

  it('uses shared canonical JSON for replay-stable chunk checksums', () => {
    expect(chunkHash({ sequence: 0, points })).toBe(chunkHash({ points, sequence: 0 }));
  });

  it('excludes rejected GPS gaps and invalid samples from active time and distance', () => {
    const output = validateTrace([
      {
        latitude: 19.076,
        longitude: 72.8777,
        recordedAt: '2026-08-27T10:00:00.000Z',
        accuracyMeters: 5
      },
      {
        latitude: 19.077,
        longitude: 72.8787,
        recordedAt: '2026-08-27T10:01:00.000Z',
        accuracyMeters: 5
      },
      {
        latitude: 19.078,
        longitude: 72.8797,
        recordedAt: '2026-08-27T10:03:30.000Z',
        accuracyMeters: 5
      },
      {
        latitude: 19.079,
        longitude: 72.8807,
        recordedAt: '2026-08-27T10:04:30.000Z',
        accuracyMeters: 120
      }
    ]);
    expect(output).toMatchObject({
      activeDurationSeconds: 60,
      acceptedPointCount: 3,
      rejectedPointCount: 1,
      rejectedGapCount: 1
    });
  });
});
