import type { ActivityMetrics, RunLogItem } from '@runsphere/contracts';
import { describe, expect, it } from 'vitest';
import {
  bestEffortRows,
  chartPath,
  linesFromGeometry,
  scrubAt,
  splitRows,
  statCells,
  thinLines,
  valueAt
} from './run-detail-layout-model.js';

const item: RunLogItem = {
  id: 'run-1',
  startedOn: '2026-11-17',
  distanceMeters: 2_500,
  durationSeconds: 800,
  movingSeconds: 780,
  paceSecondsPerKm: 312,
  elevationGainMeters: null,
  runMode: 'turf',
  result: {},
  route: null
};

const split = (
  km: number,
  distanceMeters: number,
  pace: number,
  climb: number,
  partial = false
) => ({
  km,
  distanceMeters,
  movingSeconds: (pace * distanceMeters) / 1_000,
  paceSecondsPerKm: pace,
  elevationChangeMeters: climb,
  partial
});

const metrics: ActivityMetrics = {
  metricsVersion: 1,
  elapsedSeconds: 820,
  activeSeconds: 800,
  movingSeconds: 780,
  distanceMeters: 2_500,
  averagePaceSecondsPerKm: 320,
  movingPaceSecondsPerKm: 312,
  splits: [split(1, 1_000, 300, 4), split(2, 1_000, 330, -3), split(3, 500, 300, 0, true)],
  fastestSplitKm: 1,
  bestEfforts: [
    { key: '400m', distanceMeters: 400, seconds: 115 },
    { key: '1k', distanceMeters: 1_000, seconds: 298 }
  ],
  elevation: { gainMeters: 9.6, lossMeters: 5, maxMeters: 20, minMeters: 10 },
  paceSeries: [
    [0, 300],
    [1_250, 330],
    [2_500, 300]
  ],
  elevationSeries: [
    [0, 10],
    [2_500, 20]
  ]
};

/** 2.5 km due north, synthetic, near 0°, 0°. */
const lines = [[[0, 0] as [number, number], [0, 2_500 / 111_195] as [number, number]]];

describe('run detail layout (M9 9.19)', () => {
  it('fills the stats grid from metrics, or from the log item alone', () => {
    expect(statCells(item, metrics)).toEqual([
      { label: 'Distance', value: '2.50 km' },
      { label: 'Elapsed time', value: '13:40' },
      { label: 'Pace', value: '5:12 /km' },
      { label: 'Climb', value: '10 m' },
      { label: 'Best km', value: '5:00 /km' }
    ]);
    expect(statCells(item, undefined).map((cell) => cell.label)).toEqual([
      'Distance',
      'Elapsed time',
      'Pace'
    ]);
  });

  it('draws splits as bars relative to the run’s own quickest km', () => {
    const rows = splitRows(metrics);
    expect(rows.map((row) => [row.label, row.pace, row.climb, row.fastest])).toEqual([
      ['Km 1', '5:00 /km', '+4 m', true],
      ['Km 2', '5:30 /km', '−3 m', false],
      ['Last 0.50 km', '5:00 /km', '0 m', false]
    ]);
    expect(rows[0]!.bar).toBe(1);
    expect(rows[1]!.bar).toBeCloseTo(300 / 330, 3);
    expect(splitRows(undefined)).toEqual([]);
  });

  it('names best efforts in runner words', () => {
    expect(bestEffortRows(metrics)).toEqual([
      { label: '400 m', value: '1:55' },
      { label: '1 km', value: '4:58' }
    ]);
  });

  it('draws charts with quicker pace higher', () => {
    const pace = chartPath(metrics.paceSeries, 300, 100, true)!;
    const ys = [...pace.path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    // The slow middle sits lower on screen (larger y) than the quick ends.
    expect(ys[1]).toBeGreaterThan(ys[0]!);
    expect(chartPath([[0, 1]], 300, 100)).toBeNull();
  });

  it('scrubs to a distance, its value and the place on the route', () => {
    const mid = scrubAt(150, 300, metrics, lines, 'pace');
    expect(mid.distanceMeters).toBe(1_250);
    expect(mid.label).toBe('1.25 km · 5:30 /km');
    expect(mid.position![1] * 111_195).toBeCloseTo(1_250, -1);
    expect(scrubAt(999, 300, metrics, lines, 'elevation').label).toBe('2.50 km · 20 m');
    expect(valueAt([], 10)).toBeUndefined();
  });

  it('reads the route from the detail and thins it for the map', () => {
    const long = Array.from({ length: 2_000 }, (_, i) => [0, i * 0.00001] as [number, number]);
    const thinned = thinLines([long], 600);
    expect(thinned[0]!.length).toBeLessThanOrEqual(601);
    expect(thinned[0]!.at(-1)).toEqual(long.at(-1));
    expect(linesFromGeometry({ type: 'LineString', coordinates: long })).toHaveLength(1);
    expect(linesFromGeometry(null)).toBeUndefined();
  });
});
