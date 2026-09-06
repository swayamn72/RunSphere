-- Territory lineage, club control, and run integrity (Phase 5, milestones 5.2
-- and 5.3; ADR-0011).
--
-- Three things `031` left out, each of which turned out to be needed the moment
-- the map had more than one owner on it:
--
--   1. **What the loop actually was.** A challenger needs the distance to know
--      what they are taking on, and the recommender needs it to estimate a time.
--   2. **Where the ground has been.** A territory that remembers nothing cannot
--      answer "who took mine" beyond one step, and the history is most of what
--      makes a piece of ground feel like it has a story.
--   3. **Whether the run was a run.** Ownership is decided by time, so a
--      fabricated time takes real ground off a real person.

ALTER TABLE territory_claims
  -- The length of the closed loop. Stored rather than derived on read: the
  -- boundary is simplified for drawing, so recomputing it later would give a
  -- slightly different number than the one the runner was shown.
  ADD COLUMN IF NOT EXISTS distance_metres double precision
    CHECK (distance_metres IS NULL OR distance_metres > 0),
  -- How many times this ground has changed hands, carried forward through every
  -- takeover. A first claim is 1.
  ADD COLUMN IF NOT EXISTS capture_count integer NOT NULL DEFAULT 1
    CHECK (capture_count >= 1),
  -- Who held it immediately before. Nulled if that account is erased; the
  -- takeover ledger keeps the fact that it changed hands either way.
  ADD COLUMN IF NOT EXISTS previous_owner_account_id uuid
    REFERENCES accounts(id) ON DELETE SET NULL,
  -- The club this was claimed for, when the owner was in one at the time.
  -- Recorded on the claim rather than joined from current membership, so
  -- leaving a club does not silently rewrite who held ground last month.
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES clubs(id) ON DELETE SET NULL,
  -- The first claim in this chain of takeovers. Every claim over the same
  -- ground shares it, which is what makes a history readable as one story
  -- rather than as a pile of unrelated polygons.
  ADD COLUMN IF NOT EXISTS lineage_id uuid;

-- Existing rows are each the start of their own lineage.
UPDATE territory_claims SET lineage_id = id WHERE lineage_id IS NULL;

CREATE INDEX IF NOT EXISTS territory_claims_lineage_idx
  ON territory_claims (lineage_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS territory_claims_club_idx
  ON territory_claims (club_id, claimed_at DESC)
  WHERE club_id IS NOT NULL AND released_at IS NULL;

-- A run that could not have been run, kept for a human to look at.
--
-- **Nothing here punishes anybody.** A flagged run is still the runner's: it
-- keeps its distance, its history, and its place in their totals. What it does
-- not get is territory, because ownership is decided by time and this is the
-- only thing standing between that and a fabricated one. GPS in a city is bad
-- enough that an automatic ban would eventually hit somebody honest.
CREATE TABLE IF NOT EXISTS run_integrity_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('review', 'rejected')),
  -- The named checks that fired, so a reviewer sees what the machine saw.
  findings text[] NOT NULL DEFAULT '{}',
  -- The numbers behind the verdict, so a reviewer can disagree with it.
  peak_speed_mps double precision NOT NULL CHECK (peak_speed_mps >= 0),
  average_speed_mps double precision NOT NULL CHECK (average_speed_mps >= 0),
  distance_metres double precision NOT NULL CHECK (distance_metres >= 0),
  straightness double precision NOT NULL CHECK (straightness BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when staff have looked. Never set by the system.
  reviewed_at timestamptz,
  reviewed_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 500),
  -- One verdict per run: re-running the check replaces what it said before.
  UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS run_integrity_flags_open_idx
  ON run_integrity_flags (created_at DESC)
  WHERE reviewed_at IS NULL;
