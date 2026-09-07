# ML Implementation Plan

**Last updated:** 2026-09-07
**Status:** Approved for implementation. Not yet started.
**Agent reading this:** This document contains everything needed to implement the two ML systems described here. Read `pending-work.md` Section 5 for task-level breakdown. Read `packages/domain/src/run-integrity.ts` before touching the anti-cheat system — the rule-based layer that the ML model supplements already exists.

---

## Overview

RunSphere uses two ML systems, both of which improve automatically as more runs are recorded:

| System | What it does | Model type |
|---|---|---|
| **Anti-Cheat Anomaly Detector** | Identifies GPS-spoofed, vehicle-recorded, or otherwise fraudulent runs | Isolation Forest |
| **Quest Recommendation Engine** | Surfaces quests and unexplored areas most likely to interest each specific user | Collaborative Filtering |

Both are **additive** — they do not replace the existing rule-based validation in `run-integrity.ts`. They run after the rule-based gates, not instead of them.

---

## System 1: Anti-Cheat Anomaly Detection

### The Problem the Rule-Based System Cannot Solve

`packages/domain/src/run-integrity.ts` already catches obvious fraud: speed over 7 m/s, GPS teleportation, impossible acceleration. What it cannot catch is **edge-case spoofing** that stays within plausible numbers:

- An e-bike ridden slowly (4.5 m/s — below the rejection threshold, but the GPS jitter and cornering behaviour are completely wrong for a runner)
- A car ride that matches a "slow jog" in a straight section but makes impossible lane changes at junctions
- GPS spoofing apps that synthesize a realistic-looking path (correct speed, but no micro-variation in signal quality that real running produces)
- A runner who hands their phone to a cyclist to "record" a fast loop for them

The rule-based system is a hard floor. The ML model is everything above that floor.

### Data Pipeline — Where Training Data Comes From

Every activity submission, whether accepted or rejected, is stored with a label. The table `activity_submissions` records:

- `integrity_result` — outcome of the rule-based gate: `accepted`, `rejected_speed`, `rejected_teleport`, `rejected_too_short`, `rejected_too_few_points`
- `raw_trace_retention_until` — raw GPS trace kept for 30 days after submission, then purged

**For the ML training pipeline**, a background job (`services/worker/`) reads accepted and rejected submissions within their 30-day retention window and extracts features into a separate `ml_run_features` table. This table has no raw coordinates — only derived numbers (see feature list below). Features are retained indefinitely; raw GPS is not.

### What Happens to a 10-Second Run

This is the complete server-side journey of a run that lasted 10 seconds:

1. **GPS submission:** The phone uploads its trace (likely 2 GPS points, 10 seconds apart).
2. **`run-integrity.ts` checks:**
   - Speed check: passes (the runner barely moved)
   - Minimum points check: **FAILS.** `detectLoopClaim` requires ≥4 GPS points. Returns `refusal: 'too_few_points'`.
3. **Result:** Stored in `activity_submissions` with `integrity_result = 'rejected_too_few_points'`. The run counts toward the user's active-minutes total only if they ran for at least 2 consecutive valid minutes (the XP gate). This 10-second run does not earn XP.
4. **ML pipeline:** YES — the feature extractor **does** process this run. It is labelled `rejected_too_few_points` and added to the training set. This trains the ML model to learn what a genuine "stopped the timer too fast" looks like versus a "tried to spoof a tiny loop."
5. **Territory claim:** None. No loop is possible in 10 seconds.
6. **No error shown to the user.** The app simply shows "No loop this time. Your run is saved." The rejection reason is not surfaced.

The ML model learns from ALL run outcomes — this is how it gets smarter over time about the difference between "short legitimate run" and "suspicious short run."

### Feature Engineering

The following features are extracted per run and stored in `ml_run_features`. No raw coordinates are stored anywhere in this table.

**Kinematic features (speed and movement):**
| Feature | Description |
|---|---|
| `mean_speed_mps` | Average speed in m/s over the accepted GPS points |
| `max_speed_mps` | Peak speed across any 5-second window |
| `speed_variance` | Variance of the speed distribution — a car has low variance, a runner has high variance |
| `p95_speed_mps` | 95th percentile speed — catches brief spikes |
| `speed_skew` | Asymmetry of the speed distribution — runners slow at turns, cars do not |

**Jitter features (GPS signal quality):**
| Feature | Description |
|---|---|
| `mean_horizontal_accuracy_m` | Average reported GPS accuracy in metres |
| `accuracy_variance` | Variance of accuracy — real runners have consistent signal outdoors |
| `lateral_deviation_m` | Mean deviation from the smoothed path centre-line — runners zigzag slightly, cars stay in lanes |
| `signal_loss_gaps` | Number of gaps > 10 seconds in the trace |

**Cornering and turn features:**
| Feature | Description |
|---|---|
| `mean_turn_rate_deg_per_sec` | How sharply the runner changes direction on average |
| `max_turn_rate_deg_per_sec` | Sharpest single turn — impossible values indicate a vehicle |
| `sharp_turn_count` | Number of turns > 90 degrees at > 3 m/s — runners slow for sharp corners, cyclists do not |

**Loop geometry features:**
| Feature | Description |
|---|---|
| `loop_closure_gap_m` | How close the end-point came to the start (from `detectLoopClaim`) |
| `loop_area_sqm` | Enclosed area of the detected loop, if any |
| `loop_perimeter_m` | Perimeter distance of the closed loop |
| `isoperimetric_ratio` | `(4π × area) / perimeter²` — a perfect circle is 1.0; a long thin loop is near 0. A runner running a natural city block has a predictable range |

**Run meta features:**
| Feature | Description |
|---|---|
| `total_duration_seconds` | Full run duration including warm-up and cool-down |
| `total_distance_m` | Total distance covered across the whole trace |
| `accepted_point_fraction` | Share of GPS points that passed the signal quality gates |
| `hour_of_day` | 0–23 — not used for scoring, but useful for understanding fleet-level patterns |

**Label (for training):**
- `fraud` — manually flagged by a staff reviewer OR produced a claim that was later reversed by staff
- `suspicious` — rejected by one or more rule-based gates
- `legitimate` — accepted and not flagged

### Model Architecture

**Phase 1 — Cold Start (Rule-Based Only, currently live in `run-integrity.ts`)**

No ML model yet. The hard rules in `run-integrity.ts` handle all validation. All runs are labelled and stored. This phase lasts until the training dataset has ≥2,000 runs across all labels.

**Phase 2 — Offline Isolation Forest (≥2,000 labelled runs)**

File location: `services/ml/src/anticheat/train.py`

```python
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pandas as pd, joblib, psycopg2

# Read features from ml_run_features, excluding label column
df = pd.read_sql("SELECT * FROM ml_run_features WHERE label != 'fraud'", conn)
X = df[FEATURE_COLUMNS]

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

model = IsolationForest(
    n_estimators=200,
    contamination=0.03,   # We expect ~3% of runs to be anomalous
    random_state=42
)
model.fit(X_scaled)

joblib.dump({'model': model, 'scaler': scaler}, 'anticheat_v1.joblib')
```

**Why Isolation Forest:** It is an unsupervised anomaly detector — it learns what "normal" looks like from the bulk of legitimate data without needing a large labelled fraud set (which we won't have at launch). It is fast at inference (milliseconds per run), can be explained, and is trivially retrained.

**Phase 3 — FastAPI Microservice Deployment**

File location: `services/ml/src/anticheat/server.py`

```python
from fastapi import FastAPI
from pydantic import BaseModel
import joblib, numpy as np

app = FastAPI()
artifact = joblib.load('anticheat_v1.joblib')
model = artifact['model']
scaler = artifact['scaler']

class RunFeatures(BaseModel):
    mean_speed_mps: float
    max_speed_mps: float
    speed_variance: float
    # ... all features

@app.post("/score")
def score(features: RunFeatures):
    X = np.array([[getattr(features, col) for col in FEATURE_COLUMNS]])
    X_scaled = scaler.transform(X)
    score = model.decision_function(X_scaled)[0]
    is_anomaly = model.predict(X_scaled)[0] == -1
    return {
        "anomaly": is_anomaly,
        "confidence": float(score),   # More negative = more anomalous
        "action": "flag_for_review" if is_anomaly else "pass"
    }
```

**Phase 4 — Continuous Retraining (Monthly)**

A worker job (`services/worker/src/ml-retrain-job.ts`) runs on the 1st of each month:
1. Queries `ml_run_features` for all runs from the last 6 months
2. POSTs to a training endpoint on the ML microservice
3. The new model artifact is versioned (e.g., `anticheat_v2.joblib`) and the old one is kept
4. A staff reviewer must confirm no precision degradation before the new model is promoted to live

### Integration into the Run Submission Pipeline

In `services/api/src/territory-claim-routes.ts`, after the rule-based checks pass, the claim submission pipeline adds one step:

```
1. Run GPS trace through run-integrity.ts gates      ← already exists
2. Extract features → POST to /ml/score              ← NEW
3. If anomaly confidence < -0.3: flag claim, hold for staff review
4. If anomaly confidence between -0.3 and 0.0: pass but mark "low confidence"
5. If anomaly confidence > 0.0: pass normally
6. Proceed with H3 carving and territory claim write
```

**Critical rule:** The ML model **never rejects a run outright on its own.** It flags for review. Only the rule-based gates (`run-integrity.ts`) can produce an automated rejection. This prevents the ML model from unfairly punishing legitimate runners with unusual running styles.

### New Database Table

Migration file: `infra/postgres/migrations/044_ml_run_features.sql`

```sql
CREATE TABLE ml_run_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_submission_id uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  
  -- Kinematic
  mean_speed_mps double precision,
  max_speed_mps double precision,
  speed_variance double precision,
  p95_speed_mps double precision,
  speed_skew double precision,
  
  -- Jitter
  mean_horizontal_accuracy_m double precision,
  accuracy_variance double precision,
  lateral_deviation_m double precision,
  signal_loss_gaps integer,
  
  -- Cornering
  mean_turn_rate_deg_per_sec double precision,
  max_turn_rate_deg_per_sec double precision,
  sharp_turn_count integer,
  
  -- Loop geometry
  loop_closure_gap_m double precision,
  loop_area_sqm double precision,
  loop_perimeter_m double precision,
  isoperimetric_ratio double precision,
  
  -- Run meta
  total_duration_seconds integer,
  total_distance_m double precision,
  accepted_point_fraction double precision,
  hour_of_day smallint,
  
  -- Ground truth label for training
  label text NOT NULL DEFAULT 'legitimate'
    CHECK (label IN ('legitimate', 'suspicious', 'fraud')),
  label_source text NOT NULL DEFAULT 'rule_based'
    CHECK (label_source IN ('rule_based', 'staff_review', 'model_flag')),
  
  -- ML model scoring result, written after inference
  ml_anomaly_score double precision,
  ml_model_version text,
  ml_flagged boolean NOT NULL DEFAULT false,
  
  extracted_at timestamptz NOT NULL DEFAULT now()
);

-- No raw coordinates stored anywhere in this table
COMMENT ON TABLE ml_run_features IS
  'Derived run features for ML anti-cheat training. Contains no raw GPS coordinates.';
```

---

## System 2: Quest Recommendation Engine

### The Problem

Today, quests are shown in a flat list sorted by proximity. A user who runs long coastal routes gets the same quest list as someone who prefers short park loops. As the quest catalogue grows, this becomes an engagement problem — the right quest for a given user is buried.

### How it Works — Collaborative Filtering

This is the same technique Netflix uses for recommendations. The system finds users who are "similar" to you (based on which quests they have accepted and completed), then recommends quests those similar users enjoyed that you have not yet done.

**Data source:** `quest_acceptances` and `quest_completions` tables (already exist in `008_product_core_goals_quests.sql`). No location data used — only which quests were interacted with.

**Model:** Matrix factorization using `scikit-surprise` or `implicit` library (collaborative filtering). Each user and each quest are embedded in a latent space. Proximity in that space means "likely to be enjoyed."

### Implementation

File location: `services/ml/src/recommend/train.py`

```python
from implicit import als
import scipy.sparse as sparse

# User-quest interaction matrix (1 = accepted, 2 = completed, 0 = not seen)
interactions = build_interaction_matrix(db)

model = als.AlternatingLeastSquares(factors=64, iterations=20)
model.fit(interactions)

# Recommendation: for user_id, return top-N quest IDs they haven't seen
recommendations = model.recommend(user_idx, interactions[user_idx], N=5, filter_already_liked=True)
```

**API endpoint:** `GET /quests/recommended?accountId=...&lat=...&lng=...`
- Returns up to 5 quest IDs sorted by the recommendation score
- Filtered by proximity: only quests within 20 km of the user's current location
- Falls back to proximity-only sorting if the user has no interaction history (cold start)

**Retrain cadence:** Weekly. Quest catalogue and user preferences change slowly — weekly is sufficient.

### Data Privacy Note

The recommendation model **only sees which quests were interacted with, not where the user was.** Location is only used at serving time (filtering within 20 km) and is never stored as training data.

---

## New Files to Create

An agent implementing this should create the following:

| File | Purpose |
|---|---|
| `services/ml/src/anticheat/train.py` | Isolation Forest training script |
| `services/ml/src/anticheat/server.py` | FastAPI inference microservice |
| `services/ml/src/anticheat/features.py` | Feature extraction logic (no coordinates) |
| `services/ml/src/recommend/train.py` | Collaborative filtering training script |
| `services/ml/src/recommend/server.py` | FastAPI recommendation endpoint |
| `services/worker/src/ml-feature-extractor-job.ts` | Extracts features from accepted activity_submissions |
| `services/worker/src/ml-retrain-job.ts` | Monthly retrain trigger |
| `infra/postgres/migrations/044_ml_run_features.sql` | Feature store table |
| `packages/domain/src/run-integrity.ts` | Add ML score call after existing gates |

## Key Constraints (Do Not Violate)

1. **The ML model never auto-rejects.** It flags for review only. Auto-rejection is the exclusive domain of `run-integrity.ts` hard rules.
2. **No raw GPS in the feature table.** Features are derived numbers only. A data breach of `ml_run_features` must reveal nothing about where anyone ran.
3. **Model versions are pinned on every prediction.** Every `ml_run_features` row records which model version scored it, so a disputed flag can be replayed with the same model.
4. **Retraining requires staff sign-off.** A degrading model that suddenly flags 30% of legitimate runs must be caught before it goes live. The worker proposes a new model; a staff reviewer promotes it.
5. **Cold start is graceful.** Before Phase 2 (2,000+ runs), the system behaves identically to today — rule-based only, no ML call. The ML microservice endpoint returns `{"anomaly": false}` when no model artifact exists.
