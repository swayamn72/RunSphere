import { describe, expect, it } from 'vitest';
import {
  ML_FEATURE_COLUMNS,
  extractMlRunFeatures,
  mlFeatureVector,
  type MlPoint
} from './ml-features.js';
import { EARTH_RADIUS_METRES } from './territory-claim.js';

const BASE_LAT = 19.028;
const BASE_LNG = 72.838;
const START = Date.UTC(2026, 8, 6, 5, 0, 0);
const METRES_PER_DEGREE = (EARTH_RADIUS_METRES * Math.PI) / 180;
const north = (metres: number): number => metres / METRES_PER_DEGREE;
const east = (metres: number): number =>
  metres / (METRES_PER_DEGREE * Math.cos((BASE_LAT * Math.PI) / 180));

/** A straight run north at a steady pace. */
const straight = (options: {
  points: number;
  stepMetres: number;
  secondsPerStep: number;
  accuracyMetres?: number;
}): MlPoint[] =>
  Array.from({ length: options.points }, (_unused, index) => ({
    latitude: BASE_LAT + north(index * options.stepMetres),
    longitude: BASE_LNG,
    at: new Date(START + index * options.secondsPerStep * 1000),
    ...(options.accuracyMetres === undefined ? {} : { accuracyMetres: options.accuracyMetres })
  }));

/** A closed square loop, `side` metres per side, `perStep` metres per point. */
const square = (side: number, perStep: number, secondsPerStep: number): MlPoint[] => {
  const corners: [number, number][] = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side]
  ];
  const points: MlPoint[] = [];
  let index = 0;
  for (let edge = 0; edge < 4; edge += 1) {
    const from = corners[edge]!;
    const to = corners[(edge + 1) % 4]!;
    const steps = Math.max(1, Math.round(side / perStep));
    for (let step = 0; step < steps; step += 1) {
      const share = step / steps;
      points.push({
        latitude: BASE_LAT + north(from[1]! + (to[1]! - from[1]!) * share),
        longitude: BASE_LNG + east(from[0]! + (to[0]! - from[0]!) * share),
        at: new Date(START + index * secondsPerStep * 1000),
        accuracyMetres: 8
      });
      index += 1;
    }
  }
  points.push({
    latitude: BASE_LAT,
    longitude: BASE_LNG,
    at: new Date(START + index * secondsPerStep * 1000),
    accuracyMetres: 8
  });
  return points;
};

const featuresOf = (points: readonly MlPoint[]) => {
  const features = extractMlRunFeatures(points);
  if (!features) throw new Error('expected features');
  return features;
};

describe('the feature vector', () => {
  it('has nineteen scored columns, in a fixed order', () => {
    // The order is the contract between train.py and server.py. Changing it
    // without retraining feeds the model the wrong columns and nothing fails.
    expect(ML_FEATURE_COLUMNS).toHaveLength(19);
    expect(ML_FEATURE_COLUMNS[0]).toBe('meanSpeedMps');
    expect(ML_FEATURE_COLUMNS.at(-1)).toBe('acceptedPointFraction');
    expect(new Set(ML_FEATURE_COLUMNS).size).toBe(19);
  });

  it('never scores on the hour of day', () => {
    // `ml.md` records `hour_of_day` as "not used for scoring". A model that
    // learns the hour learns when somebody runs, and would start flagging
    // shift workers and people who run before dawn.
    expect(ML_FEATURE_COLUMNS).not.toContain('hourOfDay');
    // It is still extracted, for fleet-level questions.
    expect(featuresOf(straight({ points: 5, stepMetres: 20, secondsPerStep: 5 })).hourOfDay).toBe(
      10
    );
  });

  it('produces a number for every column, never a hole', () => {
    const vector = mlFeatureVector(featuresOf(square(200, 25, 5)));

    expect(vector).toHaveLength(ML_FEATURE_COLUMNS.length);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('kinematic features', () => {
  it('measures mean speed over the legs', () => {
    // 20 m every 5 s is 4 m/s.
    expect(
      featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 })).meanSpeedMps
    ).toBeCloseTo(4, 6);
  });

  it('takes peak speed over a five-second window, not from one bad fix', () => {
    // A single fix 300 m off course and back is GPS noise, and an
    // instantaneous peak would read it as 60 m/s. Over five seconds it is
    // smoothed into something a model can learn from.
    const noisy = straight({ points: 9, stepMetres: 20, secondsPerStep: 5 });
    noisy[4] = { ...noisy[4]!, latitude: noisy[4]!.latitude + north(300) };

    const peak = featuresOf(noisy).maxSpeedMps;

    expect(peak).toBeLessThan(70);
    // And still above the honest 4 m/s, because something did move.
    expect(peak).toBeGreaterThan(4);
  });

  it('reports zero variance for a machine-steady pace', () => {
    // The signature `ml.md` wants: "a car has low variance, a runner has high".
    expect(
      featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 })).speedVariance
    ).toBeCloseTo(0, 9);
  });

  it('separates a varying pace from a steady one', () => {
    const varying: MlPoint[] = [0, 30, 40, 75, 85, 130, 140, 190].map((metres, index) => ({
      latitude: BASE_LAT + north(metres),
      longitude: BASE_LNG,
      at: new Date(START + index * 5_000)
    }));

    expect(featuresOf(varying).speedVariance).toBeGreaterThan(1);
  });

  it('measures skew, which is how a runner slowing at corners shows up', () => {
    const steady = featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 }));
    // Mostly steady with two slow legs: a long low tail, so negative skew.
    const withPauses: MlPoint[] = [0, 20, 40, 45, 65, 85, 88, 108].map((metres, index) => ({
      latitude: BASE_LAT + north(metres),
      longitude: BASE_LNG,
      at: new Date(START + index * 5_000)
    }));

    expect(steady.speedSkew).toBeCloseTo(0, 9);
    expect(featuresOf(withPauses).speedSkew).toBeLessThan(0);
  });
});

describe('jitter features', () => {
  it('averages only the accuracies the device actually reported', () => {
    // Treating a missing reading as perfect would tell the model that older
    // uploads had flawless GPS.
    const mixed = straight({ points: 5, stepMetres: 20, secondsPerStep: 5 });
    mixed[0] = { ...mixed[0]!, accuracyMetres: 10 };
    mixed[1] = { ...mixed[1]!, accuracyMetres: 20 };

    expect(featuresOf(mixed).meanHorizontalAccuracyM).toBe(15);
  });

  it('reports zero accuracy when nothing reported any', () => {
    expect(
      featuresOf(straight({ points: 5, stepMetres: 20, secondsPerStep: 5 })).meanHorizontalAccuracyM
    ).toBe(0);
  });

  it('finds no lateral wander on a perfectly straight line', () => {
    expect(
      featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 })).lateralDeviationM
    ).toBeCloseTo(0, 6);
  });

  it('finds wander on a weaving line', () => {
    // `ml.md`: "runners zigzag slightly, cars stay in lanes".
    const weaving = straight({ points: 9, stepMetres: 20, secondsPerStep: 5 }).map(
      (point, index) => ({
        ...point,
        longitude: point.longitude + east(index % 2 === 0 ? 1.5 : -1.5)
      })
    );

    expect(featuresOf(weaving).lateralDeviationM).toBeGreaterThan(1);
  });

  it('counts gaps longer than ten seconds', () => {
    const gappy = straight({ points: 5, stepMetres: 20, secondsPerStep: 5 });
    gappy[3] = { ...gappy[3]!, at: new Date(gappy[3]!.at.getTime() + 30_000) };
    gappy[4] = { ...gappy[4]!, at: new Date(gappy[4]!.at.getTime() + 30_000) };

    expect(featuresOf(gappy).signalLossGaps).toBe(1);
  });
});

describe('cornering features', () => {
  it('finds no turning on a straight line', () => {
    const features = featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 }));

    expect(features.meanTurnRateDegPerSec).toBeCloseTo(0, 6);
    expect(features.sharpTurnCount).toBe(0);
  });

  it('counts the corners of a square as sharp turns', () => {
    // Four right angles, taken at 5 m/s: above the 3 m/s threshold.
    const features = featuresOf(square(200, 25, 5));

    expect(features.sharpTurnCount).toBeGreaterThanOrEqual(3);
    expect(features.maxTurnRateDegPerSec).toBeGreaterThan(10);
  });

  it('does not count a corner taken slowly', () => {
    // A runner slowing for a corner is the normal case, and `ml.md` says so:
    // "runners slow for sharp corners, cyclists do not".
    expect(featuresOf(square(200, 25, 60)).sharpTurnCount).toBe(0);
  });

  it('treats a turn the short way round', () => {
    // North to just-west-of-north is a small turn, not a 350 degree one.
    const nearlyStraight: MlPoint[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, at: new Date(START) },
      { latitude: BASE_LAT + north(50), longitude: BASE_LNG, at: new Date(START + 10_000) },
      {
        latitude: BASE_LAT + north(100),
        longitude: BASE_LNG - east(2),
        at: new Date(START + 20_000)
      }
    ];

    expect(featuresOf(nearlyStraight).maxTurnRateDegPerSec).toBeLessThan(1);
  });
});

describe('loop geometry features', () => {
  it('describes a square loop', () => {
    const features = featuresOf(square(200, 25, 5));

    expect(features.loopAreaSqm).toBeGreaterThan(30_000);
    expect(features.loopPerimeterM).toBeGreaterThan(700);
    // A square's isoperimetric ratio is pi/4, about 0.785.
    expect(features.isoperimetricRatio).toBeGreaterThan(0.7);
    expect(features.isoperimetricRatio).toBeLessThan(0.85);
    // It closed, so the gap is small.
    expect(features.loopClosureGapM).toBeLessThan(60);
  });

  it('reports zeroes when there was no loop, not a bad shape', () => {
    // Zero area and zero ratio together mean "no loop". A ratio alone would be
    // indistinguishable from a very thin one.
    const features = featuresOf(straight({ points: 9, stepMetres: 100, secondsPerStep: 20 }));

    expect(features.loopAreaSqm).toBe(0);
    expect(features.loopPerimeterM).toBe(0);
    expect(features.isoperimetricRatio).toBe(0);
  });
});

describe('run meta features', () => {
  it('measures the whole trace, not the loop inside it', () => {
    const features = featuresOf(straight({ points: 9, stepMetres: 20, secondsPerStep: 5 }));

    expect(features.totalDistanceM).toBeCloseTo(160, 3);
    expect(features.totalDurationSeconds).toBe(40);
  });

  it('reports the share of points that cleared the accuracy gate', () => {
    const mixed = straight({ points: 4, stepMetres: 20, secondsPerStep: 5, accuracyMetres: 10 });
    mixed[3] = { ...mixed[3]!, accuracyMetres: 400 };

    expect(featuresOf(mixed).acceptedPointFraction).toBe(0.75);
  });

  it('counts an unusable point against the accepted fraction', () => {
    const withJunk = [
      ...straight({ points: 4, stepMetres: 20, secondsPerStep: 5, accuracyMetres: 10 }),
      { latitude: Number.NaN, longitude: BASE_LNG, at: new Date(START + 30_000) }
    ];

    expect(featuresOf(withJunk).acceptedPointFraction).toBe(0.8);
  });
});

describe('traces with nothing to measure', () => {
  it('returns nothing rather than a row of zeroes', () => {
    // A row of zeroes would teach the model that a blank trace is normal.
    expect(extractMlRunFeatures([])).toBeUndefined();
    expect(
      extractMlRunFeatures([{ latitude: BASE_LAT, longitude: BASE_LNG, at: new Date(START) }])
    ).toBeUndefined();
  });

  it('returns nothing when every point shares a timestamp', () => {
    const frozen: MlPoint[] = [0, 20, 40].map((metres) => ({
      latitude: BASE_LAT + north(metres),
      longitude: BASE_LNG,
      at: new Date(START)
    }));

    expect(extractMlRunFeatures(frozen)).toBeUndefined();
  });

  it('still extracts from the ten-second run ml.md describes', () => {
    // `ml.md`: a two-point, ten-second run is rejected for a claim and *is*
    // fed to the training set, labelled — that is how the model learns the
    // difference between a short honest run and a spoofed one.
    const tenSeconds: MlPoint[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, at: new Date(START), accuracyMetres: 12 },
      {
        latitude: BASE_LAT + north(15),
        longitude: BASE_LNG,
        at: new Date(START + 10_000),
        accuracyMetres: 12
      }
    ];

    const features = extractMlRunFeatures(tenSeconds);

    expect(features).toBeDefined();
    expect(features?.totalDurationSeconds).toBe(10);
    expect(features?.loopAreaSqm).toBe(0);
  });

  it('sorts points that arrived out of order', () => {
    const shuffled = [...straight({ points: 5, stepMetres: 20, secondsPerStep: 5 })].reverse();

    expect(featuresOf(shuffled).totalDistanceM).toBeCloseTo(80, 3);
  });
});
