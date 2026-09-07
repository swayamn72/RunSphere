"""The feature vector's column order.

This list is the contract with `packages/domain/src/ml-features.ts`
(`ML_FEATURE_COLUMNS`). The scorer is sent named columns *and* values on every
request and checks them, because a vector that silently shifted by one column
would still score, and would score wrongly for months before anybody noticed.

`hour_of_day` is deliberately absent. `ml.md` records it as "not used for
scoring": a model that learns the hour learns when somebody runs, which is a
routine, and it would begin flagging shift workers and people who run before
dawn. It is stored in `ml_run_features` for fleet-level questions and it is
never fitted.
"""

FEATURE_COLUMNS: list[str] = [
    "meanSpeedMps",
    "maxSpeedMps",
    "speedVariance",
    "p95SpeedMps",
    "speedSkew",
    "meanHorizontalAccuracyM",
    "accuracyVariance",
    "lateralDeviationM",
    "signalLossGaps",
    "meanTurnRateDegPerSec",
    "maxTurnRateDegPerSec",
    "sharpTurnCount",
    "loopClosureGapM",
    "loopAreaSqm",
    "loopPerimeterM",
    "isoperimetricRatio",
    "totalDurationSeconds",
    "totalDistanceM",
    "acceptedPointFraction",
]

# The `ml_run_features` column names, in the same order, for the training read.
SQL_COLUMNS: list[str] = [
    "mean_speed_mps",
    "max_speed_mps",
    "speed_variance",
    "p95_speed_mps",
    "speed_skew",
    "mean_horizontal_accuracy_m",
    "accuracy_variance",
    "lateral_deviation_m",
    "signal_loss_gaps",
    "mean_turn_rate_deg_per_sec",
    "max_turn_rate_deg_per_sec",
    "sharp_turn_count",
    "loop_closure_gap_m",
    "loop_area_sqm",
    "loop_perimeter_m",
    "isoperimetric_ratio",
    "total_duration_seconds",
    "total_distance_m",
    "accepted_point_fraction",
]

assert len(FEATURE_COLUMNS) == len(SQL_COLUMNS), "the two column lists must line up"
