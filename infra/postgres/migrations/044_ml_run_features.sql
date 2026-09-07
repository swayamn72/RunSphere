-- The anti-cheat feature store and model registry (`ml.md` System 1).
--
-- `run-integrity.ts` is a hard floor: speeds a person cannot reach, jumps a
-- person cannot make, lines a person does not run. What it cannot see is an
-- e-bike ridden at 4.5 m/s, or a phone handed to a cyclist — traces whose every
-- number is plausible and whose *shape* is wrong. This table is what a model
-- learns that shape from.
--
-- **No coordinates, anywhere in it.** Every column is a scalar derived from a
-- trace: a speed, a variance, an angle, an area. `ml.md`: "A data breach of
-- `ml_run_features` must reveal nothing about where anyone ran." That is a
-- property of `ml-features.ts`, which computes these, and this table simply
-- has nowhere to put a coordinate even if one were offered.
--
-- **Features outlive the trace they came from.** `raw_trace_retention_until`
-- purges raw GPS after 30 days; these rows are kept, because they are what the
-- model is trained on and they are not location data. The foreign key is
-- `ON DELETE CASCADE`, so erasing an account still takes its features with it.

CREATE TABLE IF NOT EXISTS ml_run_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_submission_id uuid NOT NULL UNIQUE
    REFERENCES activity_submissions(id) ON DELETE CASCADE,

  -- Kinematic: how fast, and how evenly. A vehicle holds its speed; a runner
  -- does not.
  mean_speed_mps double precision,
  max_speed_mps double precision,
  speed_variance double precision,
  p95_speed_mps double precision,
  speed_skew double precision,

  -- Jitter: what the GPS itself looked like. A synthesised trace has no signal
  -- quality to vary.
  mean_horizontal_accuracy_m double precision,
  accuracy_variance double precision,
  lateral_deviation_m double precision,
  signal_loss_gaps integer,

  -- Cornering: runners slow for corners, cyclists lean through them.
  mean_turn_rate_deg_per_sec double precision,
  max_turn_rate_deg_per_sec double precision,
  sharp_turn_count integer,

  -- Loop geometry. `isoperimetric_ratio` is 1.0 for a circle and near 0 for a
  -- long thin loop; a run round a city block sits in a narrow band.
  loop_closure_gap_m double precision,
  loop_area_sqm double precision,
  loop_perimeter_m double precision,
  isoperimetric_ratio double precision,

  -- Run meta.
  total_duration_seconds integer,
  total_distance_m double precision,
  accepted_point_fraction double precision,
  -- Stored, never fitted. `ml.md` records it as "not used for scoring", and
  -- `ML_FEATURE_COLUMNS` leaves it out: a model that learns the hour learns
  -- when somebody runs, and would begin flagging shift workers.
  hour_of_day smallint CHECK (hour_of_day IS NULL OR hour_of_day BETWEEN 0 AND 23),

  -- The training label, and who decided it.
  label text NOT NULL DEFAULT 'legitimate'
    CHECK (label IN ('legitimate', 'suspicious', 'fraud')),
  label_source text NOT NULL DEFAULT 'rule_based'
    CHECK (label_source IN ('rule_based', 'staff_review', 'model_flag')),

  -- Scoring result, written after inference.
  ml_anomaly_score double precision,
  ml_model_version text,
  ml_flagged boolean NOT NULL DEFAULT false,

  extracted_at timestamptz NOT NULL DEFAULT now(),

  -- **A model may not label its own training data.** `ml.md` reserves `fraud`
  -- for "manually flagged by a staff reviewer OR produced a claim that was
  -- later reversed by staff". Without this constraint the loop closes: the
  -- model flags an unusual stride, the flag becomes a fraud label, and the next
  -- model is more certain about it. `model_flag` may mark a run suspicious; it
  -- may never call one fraud.
  CONSTRAINT ml_run_features_fraud_is_a_human_judgement CHECK (
    label <> 'fraud' OR label_source = 'staff_review'
  ),
  -- A flag has to say which model made it, so a disputed one can be replayed
  -- against the same artifact (`ml.md` key constraint 3).
  CONSTRAINT ml_run_features_flag_names_its_model CHECK (
    ml_flagged = false OR (ml_model_version IS NOT NULL AND ml_anomaly_score IS NOT NULL)
  )
);

-- The training read: everything with a label, oldest first.
CREATE INDEX IF NOT EXISTS ml_run_features_label_idx
  ON ml_run_features (label, extracted_at DESC);

-- The reviewer's queue.
CREATE INDEX IF NOT EXISTS ml_run_features_flagged_idx
  ON ml_run_features (extracted_at DESC)
  WHERE ml_flagged = true;

COMMENT ON TABLE ml_run_features IS
  'Derived run features for ML anti-cheat training. Contains no raw GPS coordinates.';

-- --------------------------------------------------------------------------
-- The model registry
-- --------------------------------------------------------------------------

-- `ml.md` key constraint 4: "The worker proposes a new model; a staff reviewer
-- promotes it." That needs somewhere for a proposal to sit while it waits, and
-- somewhere for the promotion to be recorded — otherwise "requires sign-off"
-- is a sentence in a document rather than a thing the system does.
--
-- Exactly one model of each kind can be live at a time, and the partial unique
-- index below is what enforces it. A second promotion has to retire the first.
CREATE TABLE IF NOT EXISTS ml_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('anticheat', 'quest_recommend')),
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 64),

  -- What the worker measured when it proposed this candidate, so a reviewer is
  -- deciding on numbers rather than on a filename.
  trained_on_runs integer NOT NULL CHECK (trained_on_runs >= 0),
  flag_rate double precision CHECK (flag_rate IS NULL OR flag_rate BETWEEN 0 AND 1),
  baseline_flag_rate double precision
    CHECK (baseline_flag_rate IS NULL OR baseline_flag_rate BETWEEN 0 AND 1),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,

  proposed_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  promoted_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  promotion_note text CHECK (promotion_note IS NULL OR char_length(promotion_note) BETWEEN 1 AND 500),
  retired_at timestamptz,

  UNIQUE (kind, version),

  -- A promotion is a person's act, so it records the person.
  CONSTRAINT ml_models_promotion_is_signed CHECK (
    (promoted_at IS NULL) = (promoted_by_account_id IS NULL)
  ),
  -- Nothing retires before it goes live.
  CONSTRAINT ml_models_retired_was_promoted CHECK (
    retired_at IS NULL OR promoted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ml_models_one_live_per_kind_idx
  ON ml_models (kind)
  WHERE promoted_at IS NOT NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS ml_models_awaiting_review_idx
  ON ml_models (kind, proposed_at DESC)
  WHERE promoted_at IS NULL;

COMMENT ON TABLE ml_models IS
  'Proposed and promoted ML artifacts. A worker proposes; a staff reviewer promotes.';

-- --------------------------------------------------------------------------
-- The published numbers
-- --------------------------------------------------------------------------

ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'territory_claim', 'leaderboard', 'notification',
  'global_board', 'route_suggestion', 'ghost_race', 'ml_anticheat'
));

-- Every threshold the policy reads, in one reviewed place. `contamination` is
-- the Isolation Forest parameter from `ml.md`; the rest are the decision bands.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'ml_anticheat',
  1,
  '{"trainingSetFloor": 2000, "holdThreshold": -0.3, "markThreshold": 0,
    "flagRateCeiling": 0.09, "contamination": 0.03, "featureColumns": 19,
    "neverAutoRejects": true}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
