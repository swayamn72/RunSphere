# ADR-0013: Launch with deterministic rules only; defer ML

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decided by:** product owner

## Context

`docs/ml.md` designs two models: an Isolation Forest anti-cheat scorer and a collaborative-filtering
quest recommender, served by `services/ml` (Python/FastAPI). The code exists but has never been
deployed. The scorer has no authentication (R2), the worker's retrain job calls a `/train` endpoint
that doesn't exist (B12), and the service has no tests. Both models also need data RunSphere doesn't
have yet: the anti-cheat model refuses to score until 2,000 labelled runs exist, and the recommender
needs real acceptance and completion history.

## Decision

Android v1 launches with **deterministic rules only**:

- Run integrity is decided by `packages/domain/src/run-integrity.ts`, which is already the only thing
  allowed to refuse a run (ML was always advisory).
- Quest recommendations use the existing proximity fallback (`QUEST_PROXIMITY_NOTE`).
- `services/ml` stays in the repository, undeployed. `ML_SCORER_URL` and `ML_TRAINER_URL` stay unset,
  which is already a supported state: the claim route makes no call and flags nothing, and the retrain
  jobs no-op.
- Feature extraction (`ml_run_features`) keeps running, so labelled data accumulates for later.

## Consequences

- R2 and B12 are deferred, not fixed. They must be fixed before `ML_SCORER_URL` or `ML_TRAINER_URL` is
  ever set.
- Revisit once there is enough real data: at least the 2,000 labelled runs `ml.md` requires for
  anti-cheat, and a meaningful volume of quest interactions for the recommender.
- No infrastructure cost for an ML service at launch (ADR-0010 budget).
