-- Territory contributions and weekly control (Phase 4, milestone 4.2).
--
-- **Still disabled.** `TERRITORY_CAPTURE_ENABLED` is false and the worker
-- refuses to score, so these tables stay empty until the Territory gate passes
-- *and* the two missing inputs exist: an H3 indexer and a public-space
-- eligibility dataset. They are created now because the engine that fills them
-- lands in the same change, and a schema arriving with its writer is easier to
-- review than one arriving alone.
--
-- The privacy shape these tables exist to hold: a contribution is a **cell and
-- a local date**, never a point, a time of day, a duration, or a route. The
-- raw trace it was derived from is purged on its own retention clock; what
-- survives is which eligible public cell somebody was in on which day, which
-- is the least that can support a season.

CREATE TABLE IF NOT EXISTS territory_cell_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- H3 index as a string, with the versions that produced it pinned beside it
  -- (ADR-0001), so a season stays reproducible after any of them changes.
  cell_index text NOT NULL CHECK (char_length(cell_index) BETWEEN 1 AND 32),
  h3_version text NOT NULL CHECK (char_length(h3_version) BETWEEN 1 AND 64),
  h3_resolution integer NOT NULL CHECK (h3_resolution BETWEEN 0 AND 15),
  algorithm_version text NOT NULL CHECK (char_length(algorithm_version) BETWEEN 1 AND 64),
  eligibility_version text NOT NULL CHECK (char_length(eligibility_version) BETWEEN 1 AND 64),
  -- The Asia/Kolkata calendar day. No time of day: a contribution says where
  -- somebody was allowed to be counted, not when they were there.
  local_date date NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  -- One cell per participant per local day (ADR-0008), enforced rather than
  -- assumed: repetition must never be worth more than presence.
  UNIQUE (season_id, account_id, cell_index, local_date)
);

CREATE INDEX IF NOT EXISTS territory_cell_contributions_week_idx
  ON territory_cell_contributions (season_id, local_date);
CREATE INDEX IF NOT EXISTS territory_cell_contributions_account_idx
  ON territory_cell_contributions (season_id, account_id, local_date);

-- Immutable weekly snapshots (ADR-0008). A new version is written rather than
-- a row updated, so a recomputation is auditable and reversible and history is
-- never rewritten.
CREATE TABLE IF NOT EXISTS territory_cell_control (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  week_starts_on date NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  cell_index text NOT NULL CHECK (char_length(cell_index) BETWEEN 1 AND 32),
  -- Opaque and stable, never a display identity: a map may show that a cell is
  -- held, and never by whom (`safety-and-privacy.md`).
  controlling_participant_ref text NOT NULL
    CHECK (char_length(controlling_participant_ref) BETWEEN 1 AND 64),
  control_days integer NOT NULL CHECK (control_days >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, week_starts_on, version, cell_index)
);

CREATE INDEX IF NOT EXISTS territory_cell_control_week_idx
  ON territory_cell_control (season_id, week_starts_on, version);

-- Season ladder standing, one row per participant per week, from capped
-- control-days rather than uncapped cell volume (ADR-0008).
CREATE TABLE IF NOT EXISTS territory_ladder_weeks (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week_starts_on date NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  points integer NOT NULL CHECK (points >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, account_id, week_starts_on, version)
);

-- The scoring parameters ADR-0008 defines, published now that an engine reads
-- them. Version 2 supersedes the division-bands-only v1 from `028` and carries
-- both: a season pins a version, and a pinned version must be complete.
--
-- `weeklyControlDayCap` is an interpretation of an under-specified rule —
-- ADR-0008 says the ladder uses "capped control-days" without saying over what
-- period or per what. It is read here as per participant per week, which is
-- the reading that makes the cap do the job the ADR gives it: stopping a
-- season from being won by covering more ground per hour. **Confirm before a
-- season runs for real.**
UPDATE rule_versions SET superseded_at = now()
WHERE kind = 'territory' AND version = 1 AND superseded_at IS NULL;

INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'territory',
  2,
  '{"divisions": [{"key": "newcomer", "maxPriorActiveWeeks": 3}, {"key": "returning", "maxPriorActiveWeeks": 25}, {"key": "established"}], "bestWindowMinutes": 60, "dailyEligibleCellCap": 40, "weeklyControlDayCap": 20}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
