import type { ActivityMetrics } from '@runsphere/contracts';
import { describe, expect, it } from 'vitest';
import type { LocationSample } from '../activity-recorder-core.js';
import type { ActivityResultPresentation } from './activity-results-model.js';
import {
  METRICS_CHECKING_NOTE,
  METRICS_DEVICE_NOTE,
  clock,
  effortTime,
  metricsPointsFromSamples,
  paceClock,
  runMetricsPanel
} from './run-metrics-preview-model.js';

/** 1.5 km north at 5:00/km, one fix a second, climbing 10 m. Synthetic, not a real place. */
const samples: LocationSample[] = Array.from({ length: 451 }, (_, index) => ({
  recordedAt: new Date(Date.UTC(2026, 10, 22, 1, 0, index)).toISOString(),
  latitude: 1 + (index * (1_000 / 300)) / 111_195,
  longitude: 1,
  accuracy: 8,
  altitude: 10 + (index * 10) / 450
}));

const serverMetrics: ActivityMetrics = {
  metricsVersion: 1,
  elapsedSeconds: 460,
  activeSeconds: 460,
  movingSeconds: 455,
  distanceMeters: 1_520,
  averagePaceSecondsPerKm: 302.6,
  movingPaceSecondsPerKm: 299.3,
  splits: [
    {
      km: 1,
      distanceMeters: 1_000,
      movingSeconds: 298,
      paceSecondsPerKm: 298,
      elevationChangeMeters: 7,
      partial: false
    },
    {
      km: 2,
      distanceMeters: 520,
      movingSeconds: 157,
      paceSecondsPerKm: 301.9,
      elevationChangeMeters: -2.6,
      partial: true
    }
  ],
  fastestSplitKm: 1,
  bestEfforts: [
    { key: '400m', distanceMeters: 400, seconds: 117.4 },
    { key: '1k', distanceMeters: 1_000, seconds: 297.6 }
  ],
  elevation: { gainMeters: 7.4, lossMeters: 2.6, maxMeters: 17, minMeters: 10 },
  paceSeries: [],
  elevationSeries: []
};

const counted = (metrics?: ActivityMetrics): ActivityResultPresentation => ({
  state: 'validated',
  detail: {
    status: 'derived',
    summary: {
      distanceMeters: 1_520,
      durationSeconds: 460,
      pointCount: 451,
      rejectedPointCount: 0,
      rejectedGapCount: 0,
      privacyTrimmed: false
    },
    ...(metrics ? { metrics } : {})
  }
});

describe('runMetricsPanel (M9 9.12)', () => {
  it('shows the phone’s own splits at once, marked as still being checked', () => {
    const panel = runMetricsPanel({ state: 'pending' }, samples)!;
    expect(panel.source).toBe('device');
    expect(panel.note).toBe(METRICS_CHECKING_NOTE);
    expect(panel.splits.map((split) => split.label)).toEqual(['Km 1', 'Last 0.50 km']);
    expect(panel.splits[0]!.pace).toBe('5:00');
    expect(panel.splits[0]!.climb).toMatch(/^\+\d+ m$/);
    expect(panel.stats.map((stat) => stat.label)).toEqual(['Climb', 'Best km']);
    expect(panel.headline).toEqual({ distanceKm: '1.50', elapsedTime: '00:07:30', pace: '5:00' });
  });

  it('switches to the server’s numbers once the run counts', () => {
    const panel = runMetricsPanel(counted(serverMetrics), samples)!;
    expect(panel).toMatchObject({ source: 'server', note: null });
    expect(panel.stats).toEqual([
      { label: 'Climb', value: '7 m' },
      { label: 'Best km', value: '4:58' }
    ]);
    expect(panel.efforts).toEqual([
      { label: '400 m', value: '1:57' },
      { label: '1 km', value: '4:58' }
    ]);
    expect(panel.splits).toEqual([
      { label: 'Km 1', pace: '4:58', climb: '+7 m', fastest: true },
      { label: 'Last 0.52 km', pace: '5:02', climb: '−3 m', fastest: false }
    ]);
  });

  it('shows elapsed time and uses moving time to calculate pace', () => {
    // 455 s moving over 1.52 km is 4:59/km; over the 460 s elapsed it would be 5:03.
    expect(runMetricsPanel(counted(serverMetrics), samples)!.headline).toEqual({
      distanceKm: '1.52',
      elapsedTime: '00:07:40',
      pace: '4:59'
    });
  });

  it('keeps the phone’s numbers for a counted run the server has none for, saying so', () => {
    expect(runMetricsPanel(counted(), samples)).toMatchObject({
      source: 'device',
      note: METRICS_DEVICE_NOTE
    });
    expect(runMetricsPanel(counted(), [])).toBeNull();
  });

  it('shows nothing for a run that did not count or was deleted', () => {
    expect(runMetricsPanel({ state: 'rejected' }, samples)).toBeNull();
    expect(runMetricsPanel({ state: 'deleted' }, samples)).toBeNull();
  });

  it('shows nothing before there is a run to measure', () => {
    expect(runMetricsPanel({ state: 'pending' }, samples.slice(0, 1))).toBeNull();
    const standing = samples.slice(0, 30).map((sample) => ({ ...sample, latitude: 1 }));
    expect(runMetricsPanel({ state: 'pending' }, standing)).toBeNull();
  });

  it('leaves climb out when the phone recorded no altitude', () => {
    const flat = samples.map((sample) => ({ ...sample, altitude: null }));
    const panel = runMetricsPanel({ state: 'pending' }, flat)!;
    expect(panel.stats.map((stat) => stat.label)).toEqual(['Best km']);
    expect(panel.splits[0]!.climb).toBeNull();
  });

  it('passes every fix to the shared function, as the upload does', () => {
    const points = metricsPointsFromSamples([{ ...samples[0]!, accuracy: null, altitude: null }]);
    expect(points[0]).toMatchObject({ accuracyMeters: null, altitudeMeters: null });
  });

  it('formats time and pace the way the result screen does', () => {
    expect(clock(3_725)).toBe('01:02:05');
    expect(paceClock(299.6)).toBe('5:00');
    expect(paceClock(null)).toBe('—');
    expect(effortTime(297.6)).toBe('4:58');
    expect(effortTime(3_725)).toBe('1:02:05');
  });
});
