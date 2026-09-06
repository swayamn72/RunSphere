-- Enclosure territory claims (Phase 5, milestone 5.1; ADR-0011).
--
-- **This is switched on**, unlike the H3 cell engine in `029`/`030`, which stays
-- behind the Territory gate. The two are independent mechanics and deliberately
-- do not share tables: one holds cells somebody traversed, this one holds the
-- area inside a loop somebody ran.
--
-- ADR-0011 records what this reverses, and the schema shows it plainly:
--
--   * `boundary` is the path the owner ran. Publishing a claim publishes that
--     path — the privacy trade ADR-0008 refused and ADR-0011 accepts.
--   * `duration_seconds` exists so a faster rival can take the ground. That is
--     a pace-based takeover, which ADR-0005 ruled out for the cell engine.
--   * the owner is joined to `accounts` and shown by name and avatar on the map.

CREATE TABLE IF NOT EXISTS territory_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The run this was read from. Kept so a disputed claim can be traced back to
  -- a validated activity; nulled rather than cascading if that run is deleted,
  -- so erasing one activity does not silently rearrange the map.
  activity_id uuid REFERENCES activity_submissions(id) ON DELETE SET NULL,
  -- The closed loop. A polygon, not a line: what is held is the enclosed area.
  boundary geometry(Polygon, 4326) NOT NULL,
  -- Where the holder's avatar sits. Stored rather than computed per read
  -- because the map asks for it on every pan.
  centroid geometry(Point, 4326) NOT NULL,
  area_sqm double precision NOT NULL CHECK (area_sqm > 0),
  -- Seconds taken to run the closed loop, and the whole of the contest: a rival
  -- who goes round the same ground in fewer seconds takes it.
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  -- Set when somebody faster takes it. Rows are never deleted: a map that
  -- forgets who held what cannot answer "who took mine".
  released_at timestamptz,
  released_to_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL,
  CONSTRAINT territory_claims_release_is_complete
    CHECK ((released_at IS NULL) = (released_to_claim_id IS NULL))
);

-- The map reads by viewport, so the live claims need a spatial index; held
-- claims are the only ones ever drawn, hence the partial index.
CREATE INDEX IF NOT EXISTS territory_claims_live_boundary_idx
  ON territory_claims USING gist (boundary)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS territory_claims_account_idx
  ON territory_claims (account_id, claimed_at DESC);

-- Every takeover, kept as its own record. The two times are copied in rather
-- than joined out, so the story stays readable after either claim is erased
-- with its account.
CREATE TABLE IF NOT EXISTS territory_claim_takeovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL,
  taken_from_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  taken_by_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL,
  taken_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  previous_duration_seconds integer NOT NULL CHECK (previous_duration_seconds > 0),
  new_duration_seconds integer NOT NULL CHECK (new_duration_seconds > 0),
  -- The point of the mechanic: the new time is strictly better. A tie leaves
  -- the ground where it was, so it can never produce a row here.
  CONSTRAINT territory_claim_takeovers_is_faster
    CHECK (new_duration_seconds < previous_duration_seconds),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_claim_takeovers_victim_idx
  ON territory_claim_takeovers (taken_from_account_id, created_at DESC);

-- `territory_claim` is a new rule kind, so the constraint has to admit it
-- before the seed below can land. Widening in the same migration that seeds is
-- what `pnpm verify:migrations` checks for.
ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'territory_claim', 'leaderboard', 'notification',
  'global_board'
));

-- The published balance numbers, so they can be changed by a reviewed migration
-- rather than a deploy. Read by `detectLoopClaim` and `claimOutcome`.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'territory_claim',
  1,
  '{"closeWithinMetres": 60, "minAreaSqm": 5000, "maxAreaSqm": 5000000, "takeoverOverlapRatio": 0.6, "maxBoundaryPoints": 128}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
