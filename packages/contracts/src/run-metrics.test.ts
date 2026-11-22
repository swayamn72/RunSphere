import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  ActivityDetailResponseSchema,
  ActivityMetricsSchema,
  type ActivityMetrics
} from './index.js';

if (!FormatRegistry.Has('uuid'))
  FormatRegistry.Set('uuid', (value) => /^[0-9a-f-]{36}$/i.test(value));

const metrics: ActivityMetrics = {
  metricsVersion: 1,
  elapsedSeconds: 1_560,
  activeSeconds: 1_560,
  movingSeconds: 1_500,
  distanceMeters: 5_200,
  averagePaceSecondsPerKm: 300,
  movingPaceSecondsPerKm: 288.5,
  splits: [
    {
      km: 1,
      distanceMeters: 1_000,
      movingSeconds: 300,
      paceSecondsPerKm: 300,
      elevationChangeMeters: 4.2,
      partial: false
    },
    {
      km: 2,
      distanceMeters: 20,
      movingSeconds: 6,
      paceSecondsPerKm: null,
      elevationChangeMeters: null,
      partial: true
    }
  ],
  fastestSplitKm: 1,
  bestEfforts: [{ key: '1k', distanceMeters: 1_000, seconds: 300 }],
  elevation: { gainMeters: 12, lossMeters: 11.5, maxMeters: 21, minMeters: 8 },
  paceSeries: [
    [0, 301],
    [26, 299.4]
  ],
  elevationSeries: []
};

describe('ActivityMetricsSchema (M9 9.11)', () => {
  it('accepts a run with metrics, and one with no elevation or full km', () => {
    expect(Value.Check(ActivityMetricsSchema, metrics)).toBe(true);
    expect(
      Value.Check(ActivityMetricsSchema, {
        ...metrics,
        splits: [],
        fastestSplitKm: null,
        bestEfforts: [],
        elevation: null,
        averagePaceSecondsPerKm: null,
        movingPaceSecondsPerKm: null
      })
    ).toBe(true);
  });

  it('has no room for a coordinate', () => {
    expect(Value.Check(ActivityMetricsSchema, { ...metrics, latitude: 19.07 })).toBe(false);
    expect(
      Value.Check(ActivityMetricsSchema, {
        ...metrics,
        splits: [{ ...metrics.splits[0]!, longitude: 72.8 }]
      })
    ).toBe(false);
    expect(Value.Check(ActivityMetricsSchema, { ...metrics, paceSeries: [[0, 300, 19.07]] })).toBe(
      false
    );
  });

  it('caps the chart series at 200 points', () => {
    const series = Array.from({ length: 201 }, (_, index): [number, number] => [index, 300]);
    expect(Value.Check(ActivityMetricsSchema, { ...metrics, paceSeries: series })).toBe(false);
  });

  it('is optional on the run detail', () => {
    const detail = { id: '00000000-0000-4000-8000-000000000001', status: 'derived' };
    expect(Value.Check(ActivityDetailResponseSchema, detail)).toBe(true);
    expect(Value.Check(ActivityDetailResponseSchema, { ...detail, metrics })).toBe(true);
  });
});
