"""Quest recommendation inference (`ml.md` System 2).

Returns a score per candidate quest for one account. It does **not** rank, cap,
or filter: `packages/domain/src/quest-recommendation.ts` does that, because the
rules that matter — never recommend a quest already done, never beyond 20 km,
break ties the same way every time — are decisions, and decisions belong
somewhere they can be tested.

**No location, in or out.** The request is an account id and a list of quest
ids. Distance filtering happened before the call.

**An account the model has never seen gets nothing**, rather than a plausible
zero. The caller reads an absent score as cold start and falls back to sorting
by distance, which it labels as such.
"""

from __future__ import annotations

import os
from pathlib import Path

import joblib
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="RunSphere quest recommender", version="1")

ARTIFACT_DIR = Path(os.environ.get("ML_ARTIFACT_DIR", "artifacts"))


def _load_latest():
    if not ARTIFACT_DIR.is_dir():
        return None
    artifacts = sorted(ARTIFACT_DIR.glob("recommend_*.joblib"))
    return joblib.load(artifacts[-1]) if artifacts else None


ARTIFACT = _load_latest()


class RecommendRequest(BaseModel):
    account_id: str = Field(..., min_length=1)
    quest_ids: list[str] = Field(default_factory=list)


class RecommendResponse(BaseModel):
    """Scores by quest id. Absent ids are ones the model has no opinion on."""

    scores: dict[str, float]
    model_version: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ready": True, "model_loaded": ARTIFACT is not None}


@app.post("/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest) -> RecommendResponse:
    if ARTIFACT is None:
        return RecommendResponse(scores={})

    accounts: list[str] = ARTIFACT["accounts"]
    quests: list[str] = ARTIFACT["quests"]
    if request.account_id not in accounts:
        # Never seen. `ml.md`: "Falls back to proximity-only sorting if the user
        # has no interaction history (cold start)" — and the fallback lives in
        # the caller, so the honest answer here is an empty map.
        return RecommendResponse(scores={}, model_version=ARTIFACT["version"])

    account_position = accounts.index(request.account_id)
    quest_positions = {quest: index for index, quest in enumerate(quests)}
    model = ARTIFACT["model"]
    matrix = ARTIFACT["matrix"]

    # `filter_already_liked_items=True`: a quest somebody has already done is
    # not a recommendation, it is a reminder. The caller filters `seen` as well
    # — the two agree, and neither relies on the other.
    ranked, scores = model.recommend(
        account_position,
        matrix[account_position],
        N=len(quests),
        filter_already_liked_items=True,
    )

    by_id: dict[str, float] = {}
    for position, score in zip(ranked, scores):
        quest_id = quests[int(position)]
        if quest_id in quest_positions and (
            not request.quest_ids or quest_id in request.quest_ids
        ):
            by_id[quest_id] = float(score)

    return RecommendResponse(scores=by_id, model_version=ARTIFACT["version"])
