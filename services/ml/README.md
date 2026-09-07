# `services/ml` — model fitting and inference

Two models, both described in [`docs/ml.md`](../../docs/ml.md):

| Model | What it does | Endpoint |
| --- | --- | --- |
| `anticheat` | Isolation Forest over run features. Flags for review; never rejects. | `POST /score` |
| `quest_recommend` | Implicit-feedback ALS over quest interactions. | `POST /recommend` |

## What this service does not do

**It never sees a GPS trace.** Feature extraction lives in
`packages/domain/src/ml-features.ts` and runs in TypeScript, next to the data.
This service is handed nineteen finished numbers in a fixed order.

`ml.md` originally placed a `features.py` here alongside the TypeScript worker
job that extracts them. Two implementations of the same twenty numbers is
training/serving skew: the model gets fitted on one definition of
`speed_variance` and scored on another, nothing errors, and the predictions are
quietly wrong. There is one definition, and it is not in this directory.

**It never rejects a run.** `/score` returns a number. What that number means
for a claim is decided by `packages/domain/src/ml-anticheat.ts`, which cannot
express a rejection — `run-integrity.ts` remains the only thing that refuses a
run. See `ml.md` key constraint 1.

**It never promotes its own model.** `/train` fits a candidate and returns its
metrics. The worker writes it to `ml_models` unpromoted. A staff reviewer
promotes it. See `ml.md` key constraint 4.

## Status

**Not deployed, and not reachable from CI.** The TypeScript side treats an
absent `ML_SCORER_URL` as normal — no call, no flag, no change to how a claim
behaves — which is the state the deployment is in and will stay in until
somebody runs this. The same is true of `ML_TRAINER_URL`.

There is no Python toolchain in this repository's CI, so **the code in this
directory is not linted, typechecked, or tested by `pnpm test`.** That is a
real gap and it is stated here rather than hidden: the TypeScript contract
(`ml-scoring.ts`, `ml-retrain-job.ts`) is fully tested against a fake, and this
side is not.

## Running it

```bash
cd services/ml
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

export DATABASE_URL=postgres://...
uvicorn src.anticheat.server:app --port 8081
```

Then, for the API:

```bash
export ML_SCORER_URL=http://localhost:8081
```

## Cold start

With no `anticheat_*.joblib` on disk, `/score` returns `{"anomaly": false}` and
no model version. `ml-scoring.ts` treats a score with no version as no score at
all, so a claim passes. `ml.md` key constraint 5.

The feature store has to reach 2,000 rows before the TypeScript side will call
`/score` at all — it does not ask, so an empty model is never consulted.
