import { Type, type Static } from '@sinclair/typebox';
import { Strict } from './common.js';

/**
 * A run's metrics (M9 9.11), as computed by `computeRunMetrics`
 * (`packages/domain/src/run-metrics.ts`, which explains each definition) and
 * stored in `activity_metrics`.
 *
 * Nothing here is a coordinate: splits, best efforts and both series are keyed
 * by distance along the run.
 *
 * Rows are stored once and kept after the raw points are purged, so a row
 * written under an older `metricsVersion` may be served for good. Change this
 * schema only by adding optional fields; never rename or tighten one.
 */
const NonNegative = Type.Number({ minimum: 0 });
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
/** `[distanceMeters, value]`. */
const SeriesPointSchema = Type.Tuple([NonNegative, Type.Number()]);

export const RunSplitSchema = Type.Object(
  {
    km: Type.Integer({ minimum: 1 }),
    distanceMeters: NonNegative,
    movingSeconds: NonNegative,
    paceSecondsPerKm: NullableNumber,
    elevationChangeMeters: NullableNumber,
    partial: Type.Boolean()
  },
  Strict
);

export const BestEffortKeySchema = Type.Union([
  Type.Literal('400m'),
  Type.Literal('1k'),
  Type.Literal('1mile'),
  Type.Literal('5k'),
  Type.Literal('10k'),
  Type.Literal('half')
]);

export const RunBestEffortSchema = Type.Object(
  { key: BestEffortKeySchema, distanceMeters: NonNegative, seconds: NonNegative },
  Strict
);

export const RunElevationSchema = Type.Object(
  {
    gainMeters: NonNegative,
    lossMeters: NonNegative,
    maxMeters: Type.Number(),
    minMeters: Type.Number()
  },
  Strict
);

export const ActivityMetricsSchema = Type.Object(
  {
    metricsVersion: Type.Integer({ minimum: 1 }),
    elapsedSeconds: NonNegative,
    activeSeconds: NonNegative,
    movingSeconds: NonNegative,
    distanceMeters: NonNegative,
    averagePaceSecondsPerKm: NullableNumber,
    movingPaceSecondsPerKm: NullableNumber,
    /** One per km; a marathon-and-a-bit fits easily. */
    splits: Type.Array(RunSplitSchema, { maxItems: 500 }),
    fastestSplitKm: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    bestEfforts: Type.Array(RunBestEffortSchema, { maxItems: 6 }),
    elevation: Type.Union([RunElevationSchema, Type.Null()]),
    paceSeries: Type.Array(SeriesPointSchema, { maxItems: 200 }),
    elevationSeries: Type.Array(SeriesPointSchema, { maxItems: 200 })
  },
  Strict
);

export type ActivityMetrics = Static<typeof ActivityMetricsSchema>;
export type RunSplitResponse = Static<typeof RunSplitSchema>;
export type RunBestEffortResponse = Static<typeof RunBestEffortSchema>;
