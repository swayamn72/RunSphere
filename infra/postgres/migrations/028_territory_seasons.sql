-- Territory seasons and enrollment (Phase 4, milestone 4.1).
--
-- **Territory capture is not built by this migration and remains disabled.**
-- ADR-0008 ends with "territory remains disabled until the Territory gate in
-- the release plan passes", and that gate — fair scoring, divisions,
-- concentration, anti-abuse review, and an MMR field study — has not been met.
--
-- What exists here is everything territory needs *before* it can capture
-- anything: a season a person can be told about, an opt-in enrollment, and a
-- division. None of it reads or stores a location: an H3 cell, a contribution,
-- and a control snapshot all belong with the engine, behind the gate, and are
-- deliberately absent rather than sitting empty and inviting use.
--
-- The rule this schema exists to protect: a division is assigned once, at
-- enrollment, from a published activity-history band, and never recomputed
-- mid-season (`product.md`). Rebalancing happens between seasons or not at all,
-- so the column is written once and read forever after.

CREATE TABLE IF NOT EXISTS territory_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- 'announced' is visible but not joinable; 'open' accepts enrollment;
  -- 'live' means the season window is running, which nothing can reach until
  -- the engine exists; 'ended' is history.
  status text NOT NULL DEFAULT 'announced' CHECK (status IN (
    'announced', 'open', 'live', 'ended'
  )),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  -- Pinned with the season rather than read from config at scoring time, so a
  -- finished season stays reproducible under the versions it actually ran
  -- (ADR-0001, ADR-0008). Nothing reads them yet; they are recorded now
  -- because a season created before the engine must still say what it would
  -- have been scored under.
  h3_resolution integer NOT NULL CHECK (h3_resolution BETWEEN 0 AND 15),
  scoring_rule_version integer NOT NULL CHECK (scoring_rule_version >= 1),
  privacy_policy_version text NOT NULL CHECK (char_length(privacy_policy_version) BETWEEN 1 AND 64),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  ended_at timestamptz
);

-- One season at a time is joinable. Two open seasons would make "your season"
-- ambiguous, and a member cannot be in two divisions at once.
CREATE UNIQUE INDEX IF NOT EXISTS territory_seasons_joinable_idx
  ON territory_seasons ((true)) WHERE status IN ('open', 'live');

CREATE INDEX IF NOT EXISTS territory_seasons_listing_idx ON territory_seasons (starts_at DESC);

-- Enrollment is the opt-in, and the division is decided here, once.
CREATE TABLE IF NOT EXISTS territory_enrollments (
  season_id uuid NOT NULL REFERENCES territory_seasons(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Assigned from the published activity-history band at the moment of
  -- enrollment and never rewritten: rebalancing is a between-seasons act
  -- (`product.md`), so a participant cannot be moved mid-season by anything,
  -- including their own later activity.
  division text NOT NULL CHECK (char_length(division) BETWEEN 1 AND 64),
  -- How many earlier active weeks the band was read from, kept so an
  -- assignment can be explained to the participant it was made about.
  prior_active_weeks integer NOT NULL CHECK (prior_active_weeks >= 0),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  -- Leaving is recorded, never deleted, and re-joining reopens the same row —
  -- with the division it already had, so leaving is not a way to reroll it.
  withdrawn_at timestamptz,
  PRIMARY KEY (season_id, account_id)
);

CREATE INDEX IF NOT EXISTS territory_enrollments_division_idx
  ON territory_enrollments (season_id, division) WHERE withdrawn_at IS NULL;

-- Published territory rule v1: the division bands only.
--
-- The scoring parameters ADR-0008 defines — the best contiguous 60 minutes, the
-- daily eligible-cell cap, capped control-days — are deliberately **not** here.
-- Publishing numbers nothing reads would suggest scoring exists, and the first
-- person to find them would reasonably assume they were in force. They belong
-- in the same change as the engine that honours them.
--
-- The bands are the same shape the global board publishes, read by the same
-- parser: a division is a length of time on RunSphere, never a score, a pace,
-- or a place.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'territory',
  1,
  '{"divisions": [{"key": "newcomer", "maxPriorActiveWeeks": 3}, {"key": "returning", "maxPriorActiveWeeks": 25}, {"key": "established"}]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
