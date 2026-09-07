import { KOLKATA_OFFSET_MS } from './gamification.js';
import {
  DEFAULT_CLAIM_RULE,
  detectLoopClaim,
  haversineMetres,
  type ClaimPoint,
  type ClaimRule
} from './territory-claim.js';

/**
 * Run features for the anti-cheat model (`ml.md` System 1, "Feature
 * Engineering").
 *
 * **Why this is TypeScript and not `services/ml/src/anticheat/features.py`.**
 * `ml.md` lists a Python feature extractor alongside a TypeScript worker job
 * that "extracts features from accepted activity_submissions". Two
 * implementations of the same twenty numbers is the classic training/serving
 * skew bug: the model is fitted on one definition of `speed_variance` and
 * scored on another, and nothing fails — the predictions are simply wrong, and
 * wrong in a way that shows up as a mysteriously poor model months later.
 *
 * So there is one definition, here, and it runs where the GPS already is. The
 * Python side never sees a trace: it is handed the finished numbers, for
 * training and for scoring alike.
 *
 * **No coordinates leave this file.** Every value below is a scalar derived
 * from the trace — a speed, a variance, an angle, an area. `ml.md` requires
 * that a breach of `ml_run_features` "must reveal nothing about where anyone
 * ran", and that is a property of what is computed here, not of the table.
 */

/**
 * A trace point as the extractor needs it: the claim point plus the reported
 * GPS accuracy, which `ClaimPoint` has no reason to carry.
 */
export interface MlPoint extends ClaimPoint {
  /** Metres, as the device reported it. Absent on older uploads. */
  readonly accuracyMetres?: number;
}

/** The accuracy gate the activity pipeline already applies (`activity.ts`). */
export const ML_ACCEPTED_ACCURACY_METRES = 50;

/** `ml.md`: peak speed is measured "across any 5-second window". */
export const ML_SPEED_WINDOW_SECONDS = 5;

/** `ml.md`: a gap longer than this counts as signal loss. */
export const ML_SIGNAL_GAP_SECONDS = 10;

/**
 * A sharp turn: at least 90 degrees, taken above 3 m/s.
 *
 * `ml.md` writes "> 90 degrees". Taken literally that excludes a right angle,
 * which is the shape of every city block the feature exists to describe.
 *
 * Worse, a right angle on the ground is not a 90.000 degree bearing change: the
 * meridians converge, so the corners of a square measured in metres come out
 * either side of 90 depending on latitude, and GPS moves them again. Measured
 * on a 200 m square in Mumbai, three corners land on 89.9999 and one on
 * 90.0001 — so a strict `>` counts one corner out of four, for no reason a
 * reader could ever guess.
 *
 * Hence a tolerance, and a comparison that includes the boundary.
 */
export const ML_SHARP_TURN_DEGREES = 90;
export const ML_TURN_TOLERANCE_DEGREES = 1;
export const ML_SHARP_TURN_SPEED_MPS = 3;

export interface MlRunFeatures {
  // Kinematic
  readonly meanSpeedMps: number;
  readonly maxSpeedMps: number;
  readonly speedVariance: number;
  readonly p95SpeedMps: number;
  readonly speedSkew: number;
  // Jitter
  readonly meanHorizontalAccuracyM: number;
  readonly accuracyVariance: number;
  readonly lateralDeviationM: number;
  readonly signalLossGaps: number;
  // Cornering
  readonly meanTurnRateDegPerSec: number;
  readonly maxTurnRateDegPerSec: number;
  readonly sharpTurnCount: number;
  // Loop geometry
  readonly loopClosureGapM: number;
  readonly loopAreaSqm: number;
  readonly loopPerimeterM: number;
  readonly isoperimetricRatio: number;
  // Run meta
  readonly totalDurationSeconds: number;
  readonly totalDistanceM: number;
  readonly acceptedPointFraction: number;
  readonly hourOfDay: number;
}

/**
 * The vector the model is fitted and scored on, in this order.
 *
 * **`hourOfDay` is deliberately absent.** `ml.md` records it as "not used for
 * scoring, but useful for understanding fleet-level patterns", and that
 * distinction has to be structural rather than remembered: a model that learns
 * the hour learns *when somebody runs*, which is a routine, and it would start
 * flagging shift workers and people who run before dawn. It is stored and it is
 * not fitted.
 *
 * The order is the contract between `train.py` and `server.py`. Changing it
 * without retraining silently feeds the model the wrong columns.
 */
export const ML_FEATURE_COLUMNS: readonly (keyof MlRunFeatures)[] = [
  'meanSpeedMps',
  'maxSpeedMps',
  'speedVariance',
  'p95SpeedMps',
  'speedSkew',
  'meanHorizontalAccuracyM',
  'accuracyVariance',
  'lateralDeviationM',
  'signalLossGaps',
  'meanTurnRateDegPerSec',
  'maxTurnRateDegPerSec',
  'sharpTurnCount',
  'loopClosureGapM',
  'loopAreaSqm',
  'loopPerimeterM',
  'isoperimetricRatio',
  'totalDurationSeconds',
  'totalDistanceM',
  'acceptedPointFraction'
];

/** The numbers, in `ML_FEATURE_COLUMNS` order, ready to post to the scorer. */
export const mlFeatureVector = (features: MlRunFeatures): readonly number[] =>
  ML_FEATURE_COLUMNS.map((column) => features[column]);

const usable = (point: MlPoint): boolean =>
  Number.isFinite(point.latitude) &&
  Number.isFinite(point.longitude) &&
  Number.isFinite(point.at.getTime());

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const variance = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
};

/**
 * Fisher-Pearson skewness. Zero for a symmetric distribution, positive when
 * the tail is on the high side.
 *
 * `ml.md` wants this because "runners slow at turns, cars do not" — a runner's
 * speed distribution has a long low tail from corners and crossings, and a
 * vehicle's does not.
 */
const skewness = (values: readonly number[]): number => {
  if (values.length < 3) return 0;
  const average = mean(values);
  const spread = Math.sqrt(variance(values));
  // A *relative* floor, not `spread === 0`. A perfectly even pace produces
  // legs that differ by about 1e-10 m/s from floating-point alone, and
  // dividing those differences by an equally tiny spread yields a skew of 1.15
  // — a number with no meaning that the model would nonetheless learn from.
  // Below this the distribution is flat and the skew is zero.
  if (spread < 1e-9 * Math.max(1, Math.abs(average))) return 0;
  return mean(values.map((value) => ((value - average) / spread) ** 3));
};

/** Linear-interpolated percentile of a sorted copy. */
const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
};

/** Bearing in degrees from one point to the next, 0 = north. */
const bearingDegrees = (from: MlPoint, to: MlPoint): number => {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const y = Math.sin(deltaLongitude) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLongitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

/** The smaller of the two ways round: a 350 degree turn is a 10 degree turn. */
const turnDegrees = (from: number, to: number): number => {
  const raw = Math.abs(to - from) % 360;
  return raw > 180 ? 360 - raw : raw;
};

interface Leg {
  readonly metres: number;
  readonly seconds: number;
  readonly speedMps: number;
  readonly bearing: number;
}

const legsOf = (points: readonly MlPoint[]): Leg[] => {
  const legs: Leg[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const seconds = (to.at.getTime() - from.at.getTime()) / 1000;
    if (seconds <= 0) continue;
    const metres = haversineMetres(from, to);
    legs.push({ metres, seconds, speedMps: metres / seconds, bearing: bearingDegrees(from, to) });
  }
  return legs;
};

/**
 * Fastest sustained speed over any window of at least five seconds.
 *
 * Not the fastest single leg: one bad fix between two good ones produces a
 * spike of tens of metres per second, and a feature that fires on GPS noise
 * teaches the model that noise is fraud. A five-second window smooths that out
 * while still catching a vehicle, which sustains its speed.
 */
const peakWindowSpeed = (points: readonly MlPoint[], windowSeconds: number): number => {
  let peak = 0;
  let end = 0;
  let metres = 0;
  for (let start = 0; start < points.length - 1; start += 1) {
    if (end < start) {
      end = start;
      metres = 0;
    }
    while (
      end < points.length - 1 &&
      (points[end]!.at.getTime() - points[start]!.at.getTime()) / 1000 < windowSeconds
    ) {
      metres += haversineMetres(points[end]!, points[end + 1]!);
      end += 1;
    }
    const seconds = (points[end]!.at.getTime() - points[start]!.at.getTime()) / 1000;
    if (seconds >= windowSeconds && seconds > 0) peak = Math.max(peak, metres / seconds);
    metres -= haversineMetres(points[start]!, points[start + 1]!);
  }
  return peak;
};

/**
 * Mean distance from each point to a three-point smoothed centre-line.
 *
 * `ml.md`: "runners zigzag slightly, cars stay in lanes". A vehicle's trace
 * hugs its own smoothed line; a runner's wanders around it by a metre or two.
 */
const lateralDeviation = (points: readonly MlPoint[]): number => {
  if (points.length < 3) return 0;
  const deviations: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1]!;
    const here = points[index]!;
    const after = points[index + 1]!;
    const smoothed = {
      latitude: (before.latitude + here.latitude + after.latitude) / 3,
      longitude: (before.longitude + here.longitude + after.longitude) / 3,
      at: here.at
    };
    deviations.push(haversineMetres(here, smoothed));
  }
  return mean(deviations);
};

/** Kolkata hour, because every other period in the system is scored there. */
const kolkataHour = (instant: Date): number =>
  new Date(instant.getTime() + KOLKATA_OFFSET_MS).getUTCHours();

/**
 * Every feature for one run.
 *
 * Returns `undefined` for a trace with nothing measurable in it — under two
 * usable points there are no legs, no speeds, and no turns, and a row of zeroes
 * would teach the model that a blank trace is normal.
 */
export const extractMlRunFeatures = (
  points: readonly MlPoint[],
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): MlRunFeatures | undefined => {
  const clean = points.filter(usable).sort((left, right) => left.at.getTime() - right.at.getTime());
  if (clean.length < 2) return undefined;

  const legs = legsOf(clean);
  if (legs.length === 0) return undefined;

  const speeds = legs.map((leg) => leg.speedMps);
  const totalDistanceM = legs.reduce((total, leg) => total + leg.metres, 0);
  const totalDurationSeconds = Math.max(
    0,
    Math.round((clean[clean.length - 1]!.at.getTime() - clean[0]!.at.getTime()) / 1000)
  );

  // Only points that actually reported an accuracy contribute: treating a
  // missing reading as a perfect one would tell the model that older uploads
  // had flawless GPS.
  const accuracies = clean
    .map((point) => point.accuracyMetres)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const turnRates: number[] = [];
  let sharpTurnCount = 0;
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1]!;
    const current = legs[index]!;
    const degrees = turnDegrees(previous.bearing, current.bearing);
    turnRates.push(degrees / current.seconds);
    if (
      degrees >= ML_SHARP_TURN_DEGREES - ML_TURN_TOLERANCE_DEGREES &&
      current.speedMps > ML_SHARP_TURN_SPEED_MPS
    )
      sharpTurnCount += 1;
  }

  const detection = detectLoopClaim(clean, rule);
  const loop = 'claim' in detection ? detection.claim : undefined;
  // The closure gap is how far the loop's last point fell from its first. Read
  // from the window the detector chose, the same way the ghost trace reads it,
  // so the two can never describe different loops.
  const loopPoints = loop
    ? clean.filter(
        (point) =>
          point.at.getTime() >= loop.startedAt.getTime() &&
          point.at.getTime() <= loop.finishedAt.getTime()
      )
    : [];
  const loopClosureGapM =
    loopPoints.length >= 2
      ? haversineMetres(loopPoints[0]!, loopPoints[loopPoints.length - 1]!)
      : 0;
  const loopAreaSqm = loop ? loop.areaSqm : 0;
  const loopPerimeterM = loop ? loop.perimeterMetres : 0;
  // 1.0 for a perfect circle, near 0 for a long thin loop. Zero when there is
  // no loop, which is a different thing from a badly shaped one — the label and
  // the area beside it say which.
  const isoperimetricRatio =
    loopPerimeterM > 0 ? (4 * Math.PI * loopAreaSqm) / loopPerimeterM ** 2 : 0;

  return {
    meanSpeedMps: mean(speeds),
    maxSpeedMps: peakWindowSpeed(clean, ML_SPEED_WINDOW_SECONDS),
    speedVariance: variance(speeds),
    p95SpeedMps: percentile(speeds, 0.95),
    speedSkew: skewness(speeds),
    meanHorizontalAccuracyM: mean(accuracies),
    accuracyVariance: variance(accuracies),
    lateralDeviationM: lateralDeviation(clean),
    signalLossGaps: legs.filter((leg) => leg.seconds > ML_SIGNAL_GAP_SECONDS).length,
    meanTurnRateDegPerSec: mean(turnRates),
    maxTurnRateDegPerSec: turnRates.length === 0 ? 0 : Math.max(...turnRates),
    sharpTurnCount,
    loopClosureGapM,
    loopAreaSqm,
    loopPerimeterM,
    isoperimetricRatio,
    totalDurationSeconds,
    totalDistanceM,
    acceptedPointFraction:
      points.length === 0
        ? 0
        : points.filter(
            (point) =>
              usable(point) &&
              (point.accuracyMetres ?? ML_ACCEPTED_ACCURACY_METRES) <= ML_ACCEPTED_ACCURACY_METRES
          ).length / points.length,
    hourOfDay: kolkataHour(clean[0]!.at)
  };
};
