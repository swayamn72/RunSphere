-- Territory week state, season standings, and concentration monitoring
-- (Phase 4, milestones 4.3, 4.4 and 4.6).
--
-- **Still disabled.** `TERRITORY_CAPTURE_ENABLED` is false, so nothing writes
-- to any of these. They complete the season shape so the whole of it can be
-- reviewed at the Territory gate rather than half of it.
--
-- Three things are added, and the reason each exists is worth stating:
--
--   1. **A pointer to the snapshot a week currently shows.** `029` made weekly
--      control immutable and versioned; a recomputation writes N+1 and leaves N
--      alone. Something has to say which version is the one being read, and
--      that pointer is the only thing a rollback moves.
--   2. **Season standings**, so a season ladder is a stored aggregate rather
--      than a sum recomputed differently by each reader.
--   3. **A daily concentration observation per division**, because `product.md`
--      says to monitor concentration daily and act on seven consecutive
--      breached days — which needs yesterday's answer written down.

-- Which immutable snapshot version a week currently shows, and when the week
-- was first finalized. A week is finalized only after its Kolkata week has
-- ended: a snapshot of a week still running would be a standing about to
-- change, and ADR-0006 makes weekly periods immutable once written.
CREATE TABLE IF NOT EXISTS territory_week_state (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  week_starts_on date NOT NULL,
  -- Points at a row in `territory_cell_control`. Rollback moves this and
  -- nothing else: no snapshot is ever edited or deleted.
  current_version integer NOT NULL CHECK (current_version >= 1),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, week_starts_on)
);

-- Every rollback, kept as its own record rather than as a mutation of the week.
-- A participant whose week changed can be shown what changed, when, by whom,
-- and why; "the numbers moved and nobody knows why" is the outcome this exists
-- to prevent.
CREATE TABLE IF NOT EXISTS territory_week_rollbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  week_starts_on date NOT NULL,
  from_version integer NOT NULL CHECK (from_version >= 1),
  to_version integer NOT NULL CHECK (to_version >= 1),
  -- A rollback goes backwards. Forwards is a recomputation, which is a
  -- different act and leaves a different record.
  CONSTRAINT territory_week_rollbacks_backwards CHECK (to_version < from_version),
  -- Staff-written and shown to whoever asks why a week changed, so it is
  -- required and cannot be an empty string.
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  staff_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_week_rollbacks_week_idx
  ON territory_week_rollbacks (season_id, week_starts_on, created_at DESC);

-- Cumulative season points per participant: the sum of the weekly ladder rows
-- belonging to each week's *current* snapshot version.
--
-- This one is a recomputable aggregate rather than an immutable snapshot, and
-- deliberately so: the audit trail lives in the weekly versions it is derived
-- from, and duplicating that immutability here would mean two histories that
-- could disagree. Recomputing it after a rollback is how a rollback reaches the
-- ladder at all.
CREATE TABLE IF NOT EXISTS territory_season_standings (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  division text NOT NULL CHECK (char_length(division) BETWEEN 1 AND 64),
  points integer NOT NULL CHECK (points >= 0),
  weeks_scored integer NOT NULL CHECK (weeks_scored >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, account_id)
);

CREATE INDEX IF NOT EXISTS territory_season_standings_division_idx
  ON territory_season_standings (season_id, division, points DESC);

-- One division's concentration on one day (`product.md`: top 10% no more than
-- 35% of cumulative points, top participant no more than 8%).
--
-- Stored as shares rather than as the underlying points so a monitoring read
-- never needs the per-participant totals, and stored per day because the rule
-- that matters — seven consecutive breached days — cannot be evaluated from a
-- single observation.
CREATE TABLE IF NOT EXISTS territory_concentration_checks (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  division text NOT NULL CHECK (char_length(division) BETWEEN 1 AND 64),
  observed_on date NOT NULL,
  participants integer NOT NULL CHECK (participants >= 0),
  top_decile_share numeric(6, 5) NOT NULL CHECK (top_decile_share BETWEEN 0 AND 1),
  top_participant_share numeric(6, 5) NOT NULL CHECK (top_participant_share BETWEEN 0 AND 1),
  -- False when the division is too small for the limits to be reachable at
  -- all: in a division of twelve an even split already exceeds 8%. Recording
  -- that as a breach every day would bury the real ones.
  applicable boolean NOT NULL,
  breached boolean NOT NULL,
  -- Consecutive breached days including this one. Seven pauses awards analysis
  -- and starts an investigation; it never changes anybody's standing.
  breach_run_days integer NOT NULL CHECK (breach_run_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, division, observed_on)
);

CREATE INDEX IF NOT EXISTS territory_concentration_checks_recent_idx
  ON territory_concentration_checks (season_id, observed_on DESC);
