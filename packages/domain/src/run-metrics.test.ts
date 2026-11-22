import { describe, expect, it } from 'vitest';
import {
  BEST_EFFORT_DISTANCES,
  DEFAULT_RUN_METRICS_RULE,
  RUN_METRICS_VERSION,
  computeRunMetrics,
  type RunMetricsPoint
} from './run-metrics.js';
import { EARTH_RADIUS_METRES } from './territory-claim.js';

const BASE_LAT = 19.028;
const BASE_LNG = 72.838;
const START = Date.UTC(2026, 10, 22, 0, 30, 0);
/** Pure latitude steps on the same sphere as `haversineMetres`, so distances are exact. */
const METRES_PER_DEGREE = (EARTH_RADIUS_METRES * Math.PI) / 180;

/** A trace builder: legs of steady running north or south at one fix per second. */
class Trace {
  readonly points: RunMetricsPoint[] = [];
  private northMetres = 0;
  private at = START;
  private altitude: number | null = null;

  constructor(altitude: number | null = null) {
    this.altitude = altitude;
    this.push();
  }

  private push(extra: Partial<RunMetricsPoint> = {}) {
    this.points.push({
      latitude: BASE_LAT + this.northMetres / METRES_PER_DEGREE,
      longitude: BASE_LNG,
      recordedAt: new Date(this.at).toISOString(),
      accuracyMeters: 8,
      altitudeMeters: this.altitude,
      ...extra
    });
  }

  /** Run `metres` at `secondsPerKm`, climbing `climb` metres evenly along the way. */
  run(metres: number, secondsPerKm: number, { south = false, climb = 0 } = {}) {
    const speed = 1_000 / secondsPerKm;
    const steps = Math.round(metres / speed);
    for (let step = 0; step < steps; step += 1) {
      this.northMetres += (south ? -1 : 1) * speed;
      this.at += 1_000;
      if (this.altitude !== null) this.altitude += climb / steps;
      this.push();
    }
    return this;
  }

  /** Stand still for `seconds`, with the GPS wandering a metre either way. */
  stand(seconds: number) {
    const centre = this.northMetres;
    for (let step = 0; step < seconds; step += 1) {
      this.at += 1_000;
      this.northMetres = centre + (step % 2 ? 1 : -1);
      this.push();
    }
    this.northMetres = centre;
    return this;
  }

  /** Pause the recorder: no fixes for `seconds`, and you may have moved meanwhile. */
  gap(seconds: number, movedMetres = 0) {
    this.at += seconds * 1_000;
    this.northMetres += movedMetres;
    this.push();
    return this;
  }

  /** One wild fix far away, as a bad GPS reading gives. */
  spike(offsetMetres: number, extra: Partial<RunMetricsPoint> = {}) {
    this.at += 1_000;
    this.northMetres += offsetMetres;
    this.push(extra);
    this.northMetres -= offsetMetres;
    return this;
  }
}

describe('computeRunMetrics', () => {
  it('measures a steady run: distance, paces, splits with a partial last km', () => {
    const metrics = computeRunMetrics(new Trace().run(5_200, 300).points);
    expect(metrics.metricsVersion).toBe(RUN_METRICS_VERSION);
    expect(metrics.distanceMeters).toBeCloseTo(5_200, 0);
    expect(metrics.elapsedSeconds).toBe(1_560);
    expect(metrics.movingSeconds).toBe(1_560);
    expect(metrics.activeSeconds).toBe(1_560);
    expect(metrics.averagePaceSecondsPerKm).toBeCloseTo(300, 0);
    expect(metrics.movingPaceSecondsPerKm).toBeCloseTo(300, 0);
    expect(metrics.splits).toHaveLength(6);
    for (const split of metrics.splits.slice(0, 5)) {
      expect(split.partial).toBe(false);
      expect(split.distanceMeters).toBe(1_000);
      expect(split.paceSecondsPerKm).toBeCloseTo(300, 0);
      expect(split.elevationChangeMeters).toBeNull();
    }
    expect(metrics.splits[5]).toMatchObject({ km: 6, partial: true });
    expect(metrics.splits[5]!.distanceMeters).toBeCloseTo(200, 0);
    expect(metrics.splits[5]!.paceSecondsPerKm).toBeCloseTo(300, 0);
    expect(metrics.elevation).toBeNull();
    expect(metrics.elevationSeries).toEqual([]);
  });

  it('finds best efforts only for distances the run covers', () => {
    const metrics = computeRunMetrics(new Trace().run(5_200, 300).points);
    expect(metrics.bestEfforts.map((effort) => effort.key)).toEqual(['400m', '1k', '1mile', '5k']);
    const byKey = Object.fromEntries(metrics.bestEfforts.map((e) => [e.key, e.seconds]));
    expect(byKey['400m']).toBeCloseTo(120, 0);
    expect(byKey['1k']).toBeCloseTo(300, 0);
    expect(byKey['1mile']).toBeCloseTo(482.8, 0);
    expect(byKey['5k']).toBeCloseTo(1_500, 0);
    expect(BEST_EFFORT_DISTANCES.at(-1)).toMatchObject({ key: 'half', distanceMeters: 21_097.5 });
  });

  it('on a loop with a faster second half, picks the fastest km and best effort from it', () => {
    const trace = new Trace().run(1_000, 360).run(1_000, 270, { south: true });
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.splits.map((split) => Math.round(split.movingSeconds))).toEqual([360, 270]);
    expect(metrics.fastestSplitKm).toBe(2);
    const oneK = metrics.bestEfforts.find((effort) => effort.key === '1k')!;
    expect(oneK.seconds).toBeCloseTo(270, 0);
    const fourHundred = metrics.bestEfforts.find((effort) => effort.key === '400m')!;
    expect(fourHundred.seconds).toBeCloseTo(108, 0);
  });

  it('takes a stop at the lights out of moving time but not out of elapsed time', () => {
    const trace = new Trace().run(1_000, 300).stand(60).run(1_000, 300);
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.elapsedSeconds).toBe(660);
    expect(metrics.activeSeconds).toBe(660);
    expect(metrics.movingSeconds).toBeGreaterThanOrEqual(598);
    expect(metrics.movingSeconds).toBeLessThanOrEqual(602);
    expect(metrics.movingPaceSecondsPerKm!).toBeLessThan(metrics.averagePaceSecondsPerKm!);
    // The stop is inside km 2 by a few metres of wander, but its time is not.
    for (const split of metrics.splits) expect(split.movingSeconds).toBeLessThan(310);
    // A best km doesn't get a free minute by straddling the stop.
    expect(metrics.bestEfforts.find((e) => e.key === '1k')!.seconds).toBeGreaterThan(295);
  });

  it('does not count a short pause in stride as a stop', () => {
    const trace = new Trace().run(500, 300).stand(5).run(500, 300);
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.movingSeconds).toBe(metrics.activeSeconds);
  });

  it('a recorder pause or long gap adds neither distance nor time', () => {
    const trace = new Trace().run(1_000, 300).gap(600, 2_000).run(1_000, 300);
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.distanceMeters).toBeCloseTo(2_000, 0);
    expect(metrics.activeSeconds).toBe(600);
    expect(metrics.movingSeconds).toBe(600);
    expect(metrics.elapsedSeconds).toBe(1_200);
  });

  it('ignores GPS spikes and fixes too inaccurate to trust', () => {
    const clean = computeRunMetrics(new Trace().run(2_000, 300).points);
    const spiky = new Trace().run(1_000, 300).spike(400).run(500, 300);
    spiky.spike(0, { accuracyMeters: 120 }).run(500, 300);
    const metrics = computeRunMetrics(spiky.points);
    // The spike and the bad fix each drop the segments around them, so a little less
    // distance is counted, never more: no 800 m detour appears.
    expect(metrics.distanceMeters).toBeLessThanOrEqual(clean.distanceMeters);
    expect(metrics.distanceMeters).toBeGreaterThan(clean.distanceMeters - 20);
    expect(metrics.bestEfforts.find((e) => e.key === '400m')!.seconds).toBeGreaterThan(115);
  });

  it('measures climbs and drops, smoothing out noise and one-off altitude spikes', () => {
    const trace = new Trace(10).run(1_000, 300, { climb: 30 }).run(1_000, 300, {
      south: true,
      climb: -30
    });
    trace.points.forEach((point, index) => {
      point.altitudeMeters = point.altitudeMeters! + (index % 2 ? 1 : -1);
    });
    trace.points[400]!.altitudeMeters = 90;
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.elevation).not.toBeNull();
    expect(metrics.elevation!.gainMeters).toBeGreaterThan(26);
    expect(metrics.elevation!.gainMeters).toBeLessThan(33);
    expect(metrics.elevation!.lossMeters).toBeGreaterThan(26);
    expect(metrics.elevation!.lossMeters).toBeLessThan(33);
    expect(metrics.elevation!.maxMeters).toBeLessThan(43);
    expect(metrics.elevation!.minMeters).toBeGreaterThan(7);
    expect(metrics.splits[0]!.elevationChangeMeters!).toBeCloseTo(30, -1);
    expect(metrics.splits[1]!.elevationChangeMeters!).toBeCloseTo(-30, -1);
  });

  it('reads flat ground with GPS altitude jitter as flat', () => {
    const trace = new Trace(12).run(2_000, 300);
    trace.points.forEach((point, index) => {
      point.altitudeMeters = 12 + [0, 2, -1, 1, -2][index % 5]!;
    });
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.elevation).toMatchObject({ gainMeters: 0, lossMeters: 0 });
  });

  it('leaves elevation out when too few fixes have an altitude', () => {
    const trace = new Trace().run(1_000, 300);
    trace.points.slice(0, DEFAULT_RUN_METRICS_RULE.elevationMinimumPoints - 1).forEach((p) => {
      p.altitudeMeters = 5;
    });
    expect(computeRunMetrics(trace.points).elevation).toBeNull();
  });

  it('downsamples the series to at most 200 points by distance, with no coordinates', () => {
    const trace = new Trace(20).run(10_500, 330, { climb: 15 });
    const metrics = computeRunMetrics(trace.points);
    expect(metrics.bestEfforts.map((e) => e.key)).toContain('10k');
    for (const series of [metrics.paceSeries, metrics.elevationSeries]) {
      expect(series.length).toBeGreaterThan(100);
      expect(series.length).toBeLessThanOrEqual(DEFAULT_RUN_METRICS_RULE.maximumSeriesPoints);
      for (let index = 1; index < series.length; index += 1) {
        expect(series[index]![0]).toBeGreaterThan(series[index - 1]![0]);
      }
    }
    for (const [, pace] of metrics.paceSeries) expect(pace).toBeCloseTo(330, -1);
    const stored = JSON.stringify(metrics);
    expect(stored).not.toMatch(/latitude|longitude/);
    expect(stored).not.toContain(String(BASE_LAT));
    expect(stored).not.toContain(String(BASE_LNG));
  });

  it('copes with no run at all', () => {
    expect(computeRunMetrics([])).toMatchObject({
      distanceMeters: 0,
      elapsedSeconds: 0,
      averagePaceSecondsPerKm: null,
      splits: [],
      fastestSplitKm: null,
      bestEfforts: [],
      elevation: null,
      paceSeries: []
    });
    const standing = computeRunMetrics(new Trace().stand(30).points.slice(0, 1));
    expect(standing.distanceMeters).toBe(0);
  });

  it('gives a tiny last split no pace rather than a sprint', () => {
    const metrics = computeRunMetrics(new Trace().run(1_030, 300).points);
    expect(metrics.splits).toHaveLength(2);
    expect(metrics.splits[1]!.partial).toBe(true);
    expect(metrics.splits[1]!.paceSecondsPerKm).toBeNull();
    expect(metrics.fastestSplitKm).toBe(1);
  });

  it('treats a run of exactly 5 km as five full splits with a 5k effort', () => {
    const metrics = computeRunMetrics(new Trace().run(5_000, 300).points);
    expect(metrics.splits).toHaveLength(5);
    expect(metrics.splits.every((split) => !split.partial)).toBe(true);
    expect(metrics.bestEfforts.map((e) => e.key)).toContain('5k');
  });

  it('accepts epoch-millisecond timestamps', () => {
    const points = new Trace().run(1_000, 300).points.map((point) => ({
      ...point,
      recordedAt: Date.parse(point.recordedAt as string)
    }));
    expect(computeRunMetrics(points).movingSeconds).toBe(300);
  });
});
