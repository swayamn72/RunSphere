import { haversineMetres } from './territory-claim.js';

/**
 * Run metrics (M9 9.8, `docs/plans/m9-run-modes-metrics-tutorial.md` section 3).
 *
 * One pure function turns a run's points into everything the run detail shows:
 * times, distance, paces, km splits, best efforts, elevation and two small chart
 * series. The worker runs it when a run is derived (raw points are purged after
 * 30 days, so this is the only chance) and the app runs the same code on its
 * own samples for the instant preview on the finish screen (9.12).
 *
 * **Same segments as validation.** A pair of consecutive points counts only if
 * both are accurate to 50 m, they are 0–60 s apart and the step is under
 * 25 km/h: the rule `validateTrace` in `services/api/src/activity.ts` applies.
 * So the distance here is the distance the run was credited with, and a GPS
 * spike or a pause never adds distance or time.
 *
 * **No coordinates leave this function.** Splits, best efforts and the series
 * are keyed by distance along the run, never by position, so the stored
 * metrics can be shown to someone who may not see the route.
 *
 * Metrics never affect XP, claims or scores (ADR-0005); they are for the runner.
 */

/** Bump when any definition below changes, so stored rows can be recomputed. */
export const RUN_METRICS_VERSION = 1;

export interface RunMetricsPoint {
  latitude: number;
  longitude: number;
  /** ISO timestamp or epoch milliseconds. */
  recordedAt: string | number;
  accuracyMeters?: number | null | undefined;
  /** GPS altitude. Missing on some fixes and on runs uploaded before 9.9. */
  altitudeMeters?: number | null | undefined;
}

export interface RunMetricsRule {
  maximumAccuracyMeters: number;
  maximumGapSeconds: number;
  maximumMetersPerSecond: number;
  /** Below this speed, held for `stoppedMinimumSeconds`, you are stopped. */
  stoppedMetersPerSecond: number;
  stoppedMinimumSeconds: number;
  /** Climbs or drops smaller than this are GPS noise, not hills. */
  elevationHysteresisMeters: number;
  elevationMedianWindow: number;
  /** Fewer altitude fixes than this and elevation is left out rather than guessed. */
  elevationMinimumPoints: number;
  maximumSeriesPoints: number;
  /** Pace in the chart is averaged over this much distance, or it is all GPS jitter. */
  paceSeriesWindowMeters: number;
  /** A last partial km shorter than this has no pace: a few metres would read as a sprint. */
  splitMinimumPaceMeters: number;
}

/** The first three values mirror `validateTrace`; keep them in step. */
export const DEFAULT_RUN_METRICS_RULE: RunMetricsRule = {
  maximumAccuracyMeters: 50,
  maximumGapSeconds: 60,
  maximumMetersPerSecond: 25_000 / 3_600,
  stoppedMetersPerSecond: 0.5,
  stoppedMinimumSeconds: 10,
  elevationHysteresisMeters: 3,
  elevationMedianWindow: 5,
  elevationMinimumPoints: 5,
  maximumSeriesPoints: 200,
  paceSeriesWindowMeters: 100,
  splitMinimumPaceMeters: 100
};

export interface RunSplit {
  /** 1-based km number. */
  km: number;
  distanceMeters: number;
  /** Moving time: stops inside the km don't count against it. */
  movingSeconds: number;
  paceSecondsPerKm: number | null;
  elevationChangeMeters: number | null;
  /** The last split, shorter than a km. */
  partial: boolean;
}

export type BestEffortKey = '400m' | '1k' | '1mile' | '5k' | '10k' | 'half';

export const BEST_EFFORT_DISTANCES: readonly { key: BestEffortKey; distanceMeters: number }[] = [
  { key: '400m', distanceMeters: 400 },
  { key: '1k', distanceMeters: 1_000 },
  { key: '1mile', distanceMeters: 1_609.344 },
  { key: '5k', distanceMeters: 5_000 },
  { key: '10k', distanceMeters: 10_000 },
  { key: 'half', distanceMeters: 21_097.5 }
];

export interface RunBestEffort {
  key: BestEffortKey;
  distanceMeters: number;
  /** Fastest moving time over any stretch of this length within the run. */
  seconds: number;
}

export interface RunElevation {
  gainMeters: number;
  lossMeters: number;
  maxMeters: number;
  minMeters: number;
}

/** `[distanceMeters, value]` pairs, distance increasing. */
export type RunSeries = [number, number][];

export interface RunMetrics {
  metricsVersion: number;
  /** First to last point, pauses included. */
  elapsedSeconds: number;
  /** Time on counted segments, the run's credited duration (stops included). */
  activeSeconds: number;
  /** Active time minus stops. */
  movingSeconds: number;
  distanceMeters: number;
  /** Over active time. */
  averagePaceSecondsPerKm: number | null;
  movingPaceSecondsPerKm: number | null;
  splits: RunSplit[];
  /** km number of the fastest full km, or null under 1 km. */
  fastestSplitKm: number | null;
  bestEfforts: RunBestEffort[];
  elevation: RunElevation | null;
  /** Seconds per km against distance. */
  paceSeries: RunSeries;
  /** Smoothed altitude against distance. Empty without elevation. */
  elevationSeries: RunSeries;
}

const ROUNDING_METRES = 0.5;
const round1 = (value: number) => Math.round(value * 10) / 10;

const timeOf = (point: RunMetricsPoint): number =>
  typeof point.recordedAt === 'number' ? point.recordedAt : Date.parse(point.recordedAt);

const paceOf = (seconds: number, metres: number, minimumMetres = 1): number | null =>
  metres >= minimumMetres && seconds > 0 ? round1((seconds / metres) * 1_000) : null;

/** Median of each point's neighbourhood: removes one-off altitude spikes, keeps real slopes. */
const medianSmooth = (values: readonly number[], window: number): number[] => {
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const slice = values
      .slice(Math.max(0, index - half), Math.min(values.length, index + half + 1))
      .sort((a, b) => a - b);
    const middle = Math.floor(slice.length / 2);
    return slice.length % 2 ? slice[middle]! : (slice[middle - 1]! + slice[middle]!) / 2;
  });
};

/**
 * Piecewise-linear lookup of `ys` at `x` over non-decreasing `xs`.
 * `latest` picks the last index on a flat stretch rather than the first, so a
 * best effort can start as late as possible after a stop.
 */
const interpolate = (
  xs: readonly number[],
  ys: readonly number[],
  x: number,
  latest = false
): number => {
  if (xs.length === 0) return 0;
  if (x <= xs[0]!) return latest ? ys[lastIndexAtMost(xs, xs[0]!)]! : ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[xs.length - 1]!;
  if (latest) {
    const low = lastIndexAtMost(xs, x);
    const high = low + 1;
    const span = xs[high]! - xs[low]!;
    return span > 0 ? ys[low]! + ((x - xs[low]!) / span) * (ys[high]! - ys[low]!) : ys[low]!;
  }
  const high = firstIndexAtLeast(xs, x);
  const low = high - 1;
  const span = xs[high]! - xs[low]!;
  return span > 0 ? ys[low]! + ((x - xs[low]!) / span) * (ys[high]! - ys[low]!) : ys[high]!;
};

const firstIndexAtLeast = (xs: readonly number[], x: number): number => {
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (xs[middle]! >= x) high = middle;
    else low = middle + 1;
  }
  return low;
};

const lastIndexAtMost = (xs: readonly number[], x: number): number => {
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (xs[middle]! <= x) low = middle;
    else high = middle - 1;
  }
  return low;
};

const emptyMetrics = (elapsedSeconds: number): RunMetrics => ({
  metricsVersion: RUN_METRICS_VERSION,
  elapsedSeconds: round1(elapsedSeconds),
  activeSeconds: 0,
  movingSeconds: 0,
  distanceMeters: 0,
  averagePaceSecondsPerKm: null,
  movingPaceSecondsPerKm: null,
  splits: [],
  fastestSplitKm: null,
  bestEfforts: [],
  elevation: null,
  paceSeries: [],
  elevationSeries: []
});

export const computeRunMetrics = (
  points: readonly RunMetricsPoint[],
  rule: RunMetricsRule = DEFAULT_RUN_METRICS_RULE
): RunMetrics => {
  const times = points.map(timeOf);
  const finiteTimes = times.filter(Number.isFinite);
  const elapsedSeconds =
    finiteTimes.length > 1 ? (Math.max(...finiteTimes) - Math.min(...finiteTimes)) / 1_000 : 0;
  if (points.length < 2) return emptyMetrics(elapsedSeconds);

  const accurate = points.map(
    (point) => (point.accuracyMeters ?? rule.maximumAccuracyMeters) <= rule.maximumAccuracyMeters
  );

  // Segment `index` joins point index-1 to point index; segment 0 is empty.
  const segmentSeconds = new Array<number>(points.length).fill(0);
  const segmentMetres = new Array<number>(points.length).fill(0);
  const counted = new Array<boolean>(points.length).fill(false);
  for (let index = 1; index < points.length; index += 1) {
    if (!accurate[index - 1] || !accurate[index]) continue;
    const seconds = (times[index]! - times[index - 1]!) / 1_000;
    const metres = haversineMetres(points[index - 1]!, points[index]!);
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > rule.maximumGapSeconds ||
      metres / seconds > rule.maximumMetersPerSecond
    )
      continue;
    segmentSeconds[index] = seconds;
    segmentMetres[index] = metres;
    counted[index] = true;
  }

  // Stopped: any window of counted segments lasting the minimum in which you never get
  // further from where it began than the stop speed allows. Not path length, because
  // standing still the GPS wanders a metre or two each fix and the path keeps growing;
  // and not start-to-end distance, because a turnaround on an out-and-back would read
  // as a stop.
  const stopped = new Array<boolean>(points.length).fill(false);
  for (let start = 1; start < points.length; start += 1) {
    if (!counted[start]) continue;
    let seconds = 0;
    let furthest = 0;
    let end = start;
    while (end < points.length && counted[end] && seconds < rule.stoppedMinimumSeconds) {
      seconds += segmentSeconds[end]!;
      furthest = Math.max(furthest, haversineMetres(points[start - 1]!, points[end]!));
      end += 1;
    }
    if (seconds < rule.stoppedMinimumSeconds) continue;
    if (furthest / seconds < rule.stoppedMetersPerSecond) {
      for (let index = start; index < end; index += 1) stopped[index] = true;
    }
  }

  // The axis splits, best efforts and the series run along: distance and time while
  // moving. GPS wander during a stop is left off it, or a best km could gain the
  // wandered metres for free. The headline distance still includes it, to match the
  // distance the run was credited with.
  const cumulativeMetres = new Array<number>(points.length).fill(0);
  const cumulativeMoving = new Array<number>(points.length).fill(0);
  let activeSeconds = 0;
  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const moving = !stopped[index];
    cumulativeMetres[index] = cumulativeMetres[index - 1]! + (moving ? segmentMetres[index]! : 0);
    cumulativeMoving[index] = cumulativeMoving[index - 1]! + (moving ? segmentSeconds[index]! : 0);
    activeSeconds += segmentSeconds[index]!;
    distanceMeters += segmentMetres[index]!;
  }
  const movingMetres = cumulativeMetres[points.length - 1]!;
  const movingSeconds = cumulativeMoving[points.length - 1]!;
  if (movingMetres <= 0)
    return {
      ...emptyMetrics(elapsedSeconds),
      activeSeconds: round1(activeSeconds),
      distanceMeters: round1(distanceMeters)
    };

  const movingAt = (metres: number, latest = false) =>
    interpolate(cumulativeMetres, cumulativeMoving, metres, latest);

  // Elevation: accurate fixes with an altitude, median-smoothed, against distance.
  const elevationMetres: number[] = [];
  const elevationRaw: number[] = [];
  points.forEach((point, index) => {
    const altitude = point.altitudeMeters;
    if (!accurate[index] || typeof altitude !== 'number' || !Number.isFinite(altitude)) return;
    elevationMetres.push(cumulativeMetres[index]!);
    elevationRaw.push(altitude);
  });
  const hasElevation = elevationRaw.length >= rule.elevationMinimumPoints;
  const elevationSmooth = hasElevation
    ? medianSmooth(elevationRaw, rule.elevationMedianWindow)
    : [];
  const elevationAt = (metres: number) => interpolate(elevationMetres, elevationSmooth, metres);

  let elevation: RunElevation | null = null;
  if (hasElevation) {
    let gain = 0;
    let loss = 0;
    let reference = elevationSmooth[0]!;
    for (const value of elevationSmooth) {
      if (value - reference >= rule.elevationHysteresisMeters) {
        gain += value - reference;
        reference = value;
      } else if (reference - value >= rule.elevationHysteresisMeters) {
        loss += reference - value;
        reference = value;
      }
    }
    elevation = {
      gainMeters: round1(gain),
      lossMeters: round1(loss),
      maxMeters: round1(Math.max(...elevationSmooth)),
      minMeters: round1(Math.min(...elevationSmooth))
    };
  }

  const splits: RunSplit[] = [];
  // Half a metre either side of a km boundary is rounding: a 5 km run has five full
  // splits and a 5k best effort, not a sliver of a sixth.
  for (let km = 1; (km - 1) * 1_000 < movingMetres - ROUNDING_METRES; km += 1) {
    const from = (km - 1) * 1_000;
    const to = Math.min(km * 1_000, movingMetres);
    const partial = to - from < 1_000 - ROUNDING_METRES;
    const seconds = movingAt(to) - movingAt(from);
    splits.push({
      km,
      distanceMeters: round1(to - from),
      movingSeconds: round1(seconds),
      paceSecondsPerKm: paceOf(seconds, to - from, partial ? rule.splitMinimumPaceMeters : 1),
      elevationChangeMeters: hasElevation ? round1(elevationAt(to) - elevationAt(from)) : null,
      partial
    });
  }
  const fullSplits = splits.filter((split) => !split.partial && split.movingSeconds > 0);
  const fastestSplitKm = fullSplits.length
    ? fullSplits.reduce((best, split) => (split.movingSeconds < best.movingSeconds ? split : best))
        .km
    : null;

  // Best efforts: an optimal stretch starts or ends on a recorded point, so trying each
  // point as either end, with the other end interpolated, finds the exact minimum.
  const bestEfforts: RunBestEffort[] = [];
  for (const { key, distanceMeters: length } of BEST_EFFORT_DISTANCES) {
    if (length > movingMetres + ROUNDING_METRES) continue;
    let best = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const at = cumulativeMetres[index]!;
      if (at >= length)
        best = Math.min(best, cumulativeMoving[index]! - movingAt(at - length, true));
      if (at + length <= movingMetres + ROUNDING_METRES)
        best = Math.min(best, movingAt(at + length) - cumulativeMoving[index]!);
    }
    if (Number.isFinite(best) && best > 0)
      bestEfforts.push({ key, distanceMeters: length, seconds: round1(best) });
  }

  const sampleCount = Math.min(
    rule.maximumSeriesPoints,
    Math.max(2, Math.floor(movingMetres / 10) + 1)
  );
  const samples = Array.from(
    { length: sampleCount },
    (_, index) => (movingMetres * index) / (sampleCount - 1)
  );
  const window = Math.min(rule.paceSeriesWindowMeters, movingMetres);
  const paceSeries: RunSeries = [];
  for (const at of samples) {
    const from = Math.max(0, Math.min(at - window / 2, movingMetres - window));
    const pace = paceOf(movingAt(from + window) - movingAt(from), window);
    if (pace !== null) paceSeries.push([round1(at), pace]);
  }
  const elevationSeries: RunSeries = hasElevation
    ? samples.map((at) => [round1(at), round1(elevationAt(at))])
    : [];

  return {
    metricsVersion: RUN_METRICS_VERSION,
    elapsedSeconds: round1(elapsedSeconds),
    activeSeconds: round1(activeSeconds),
    movingSeconds: round1(movingSeconds),
    distanceMeters: round1(distanceMeters),
    averagePaceSecondsPerKm: paceOf(activeSeconds, distanceMeters),
    movingPaceSecondsPerKm: paceOf(movingSeconds, movingMetres),
    splits,
    fastestSplitKm,
    bestEfforts,
    elevation,
    paceSeries,
    elevationSeries
  };
};
