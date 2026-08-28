import { describe, expect, it } from 'vitest';
import { distanceMeters, summarize, type TracePoint } from './activity.js';

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
});
