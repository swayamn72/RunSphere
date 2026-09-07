"""Anti-cheat inference (`ml.md` System 1, Phase 3).

Takes nineteen numbers and returns one. It has no database, no trace, and no
authority: what its number *means* for a claim is decided in
`packages/domain/src/ml-anticheat.ts`, which cannot express a rejection.

Three behaviours worth knowing before reading the code:

  * **No artifact is a valid state.** With nothing to load, `/score` answers
    `{"anomaly": false}` and no version. `ml-scoring.ts` discards a score with
    no version, so the claim passes. `ml.md` key constraint 5.
  * **The column order is checked on every request**, against the list stored
    inside the artifact. A caller sending the right numbers in the wrong order
    gets a 400, not a confident wrong answer.
  * **Nothing is logged about the run.** Not the vector, not the score. The
    numbers are derived and carry no location, but they are still somebody's
    run, and an inference log is not a place they need to be.
"""

from __future__ import annotations

import os
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .columns import FEATURE_COLUMNS

app = FastAPI(title="RunSphere anti-cheat", version="1")

ARTIFACT_DIR = Path(os.environ.get("ML_ARTIFACT_DIR", "artifacts"))


def _load_latest():
    """The newest artifact, or nothing at all.

    Newest by filename, which the trainer stamps with a UTC timestamp, so
    ordering is lexicographic and needs no metadata.
    """
    if not ARTIFACT_DIR.is_dir():
        return None
    artifacts = sorted(ARTIFACT_DIR.glob("anticheat_*.joblib"))
    if not artifacts:
        return None
    loaded = joblib.load(artifacts[-1])
    stored = loaded.get("feature_columns")
    if stored != FEATURE_COLUMNS:
        # Refuse to serve rather than serve wrongly. A model fitted on a
        # different column order will happily produce numbers.
        raise RuntimeError(
            "artifact feature columns do not match this build; retrain before serving"
        )
    return loaded


ARTIFACT = _load_latest()


class ScoreRequest(BaseModel):
    """Named columns and values, so a shifted vector is caught rather than scored."""

    columns: list[str] = Field(..., min_length=1)
    values: list[float] = Field(..., min_length=1)


class ScoreResponse(BaseModel):
    anomaly: bool
    confidence: float | None = None
    model_version: str | None = None
    action: str


@app.get("/health")
def health() -> dict:
    return {"ready": True, "model_loaded": ARTIFACT is not None}


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    if request.columns != FEATURE_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail="feature columns do not match this model build",
        )
    if len(request.values) != len(FEATURE_COLUMNS):
        raise HTTPException(status_code=400, detail="wrong number of features")

    if ARTIFACT is None:
        # Cold start. No model, no opinion — and deliberately no version, which
        # is what makes the caller discard this rather than treat 0.0 as a real
        # score sitting in the "pass" band.
        return ScoreResponse(anomaly=False, action="pass")

    matrix = np.array([request.values], dtype=float)
    scaled = ARTIFACT["scaler"].transform(matrix)
    confidence = float(ARTIFACT["model"].decision_function(scaled)[0])
    is_anomaly = bool(ARTIFACT["model"].predict(scaled)[0] == -1)

    return ScoreResponse(
        anomaly=is_anomaly,
        confidence=confidence,
        model_version=ARTIFACT["version"],
        # Advisory. The caller's policy decides what happens; this is a
        # description, not an instruction, and it can never say "reject".
        action="flag_for_review" if is_anomaly else "pass",
    )
