"""Fit an anti-cheat Isolation Forest (`ml.md` System 1, Phase 2).

Why an Isolation Forest: it is unsupervised, so it learns what normal looks
like from the bulk of legitimate data without needing a large labelled fraud
set — which nobody has at launch. It is milliseconds per prediction, it is
trivially retrained, and its decisions can be explained.

What this script will not do:

  * **It will not train on fraud.** Rows labelled `fraud` are excluded, as
    `ml.md` specifies. The model learns the shape of *normal*; anomaly is
    whatever falls outside it. Feeding it the fraud would teach it that fraud
    is part of normal.
  * **It will not promote itself.** It writes an artifact and prints its
    metrics. `ml-retrain-job.ts` records the candidate in `ml_models`
    unpromoted, and a staff reviewer promotes it (`ml.md` key constraint 4).
  * **It will not touch a GPS trace.** It reads nineteen numeric columns.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psycopg2
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from .columns import FEATURE_COLUMNS, SQL_COLUMNS

# `ml.md`: "We expect ~3% of runs to be anomalous".
CONTAMINATION = 0.03
N_ESTIMATORS = 200
RANDOM_STATE = 42

# `ml.md` Phase 2 opens here. Mirrors ML_TRAINING_SET_FLOOR in ml-anticheat.ts.
TRAINING_SET_FLOOR = 2_000

# Six months, as `ml.md` Phase 4 specifies for the monthly retrain.
TRAINING_WINDOW_DAYS = 180


def load_features(conn) -> pd.DataFrame:
    """Every labelled run in the window that is not known fraud."""
    columns = ", ".join(SQL_COLUMNS)
    return pd.read_sql(
        f"""
        SELECT {columns}
        FROM ml_run_features
        WHERE label <> 'fraud'
          AND extracted_at > now() - interval '{TRAINING_WINDOW_DAYS} days'
        """,
        conn,
    )


def fit(frame: pd.DataFrame) -> tuple[IsolationForest, StandardScaler, np.ndarray]:
    # Missing values are zeroed rather than dropped: a run with no reported GPS
    # accuracy is a real run, and dropping it would bias the training set
    # towards newer clients that report one.
    #
    # `.to_numpy()` on purpose. Fitting on a named DataFrame and scoring on a
    # bare array makes sklearn warn on *every* inference that it cannot check
    # the column names — which is both log noise and a real loss: the check is
    # silently not happening. Fitting nameless makes the two paths identical,
    # and the guard that actually matters is the explicit column comparison
    # `server.py` does against the list stored in the artifact.
    features = frame[SQL_COLUMNS].astype(float).fillna(0.0).to_numpy()
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)
    model = IsolationForest(
        n_estimators=N_ESTIMATORS,
        contamination=CONTAMINATION,
        random_state=RANDOM_STATE,
    )
    model.fit(scaled)
    return model, scaler, scaled


def main() -> int:
    parser = argparse.ArgumentParser(description="Fit the anti-cheat model.")
    parser.add_argument("--out", default="artifacts", help="where to write the artifact")
    parser.add_argument("--version", default=None, help="artifact version label")
    arguments = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print(json.dumps({"error": "DATABASE_URL is not set"}))
        return 2

    with psycopg2.connect(database_url) as conn:
        frame = load_features(conn)

    if len(frame) < TRAINING_SET_FLOOR:
        # Not an error. `ml.md` key constraint 5: below the floor the system is
        # rule-based only, and fitting anyway would produce an artifact that
        # looks usable and is not.
        print(
            json.dumps(
                {
                    "fitted": False,
                    "reason": "below_floor",
                    "rows": len(frame),
                    "floor": TRAINING_SET_FLOOR,
                }
            )
        )
        return 0

    model, scaler, scaled = fit(frame)

    # The share of the training data this model would flag. `ml.md` Phase 4
    # requires "no precision degradation" before promotion, and this is the
    # number `mlPromotionAdvice` compares against the live model's.
    flagged = int((model.predict(scaled) == -1).sum())
    flag_rate = flagged / len(frame)

    version = arguments.version or f"anticheat_{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    out = Path(arguments.out)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "scaler": scaler,
            # The column order is stored *with* the artifact. A model loaded
            # against a different feature order is the failure this whole file
            # is arranged to prevent, and a mismatch has to be detectable at
            # load time rather than inferred from bad predictions later.
            "feature_columns": FEATURE_COLUMNS,
            "version": version,
        },
        out / f"{version}.joblib",
    )

    print(
        json.dumps(
            {
                "fitted": True,
                "version": version,
                "trained_on_runs": len(frame),
                "flag_rate": flag_rate,
                "metrics": {
                    "contamination": CONTAMINATION,
                    "n_estimators": N_ESTIMATORS,
                    "features": len(FEATURE_COLUMNS),
                    "window_days": TRAINING_WINDOW_DAYS,
                },
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
