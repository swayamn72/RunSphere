-- Ghost Race (`territory-guide.md` "Ghost Race"; pending-work 2.10, 2.11).
--
-- You tap somebody's ground and their recorded run appears on your map as a
-- ghost advancing at the pace they actually ran it.
--
-- **Why the trace is stored rather than derived on request.** Everything the
-- ghost needs is in hand at claim time: the claim route has already read the
-- run's points out of `activity_chunks` to detect the loop. Deriving it later
-- would mean re-reading and re-scanning the raw trace on every request, and
-- that trace does not last: `activity_submissions.raw_trace_retention_until`
-- purges it after 30 days while a claim lives until the season ends. A claim
-- whose raw trace had aged out would silently lose its ghost partway through
-- the month.
--
-- **What this stores that was not already public.** A claim already publishes
-- its boundary, its perimeter, and its duration to anybody who can see the map
-- (`territory-claim.ts`), so the route and the average pace are public before
-- any of this. What is added is pacing *within* the loop. Three things bound
-- it, and all three are enforced rather than intended:
--
--   * 200 m is trimmed from each end before the row is written, so what is
--     stored can never include the arc where the runner joined and left the
--     loop — the part that tends to sit near where they live. The raw trace is
--     never copied here.
--   * A loop with nothing left after trimming gets no row at all, so a short
--     loop cannot be served in part.
--   * Reads are counted (`territory_claim_ghost_views`) and capped at three an
--     hour. That is a privacy budget, not an abuse throttle, which is why it
--     lives in the database instead of in a process that forgets on deploy.

CREATE TABLE IF NOT EXISTS territory_claim_ghost_traces (
  -- One per claim, and it never changes. A carve redraws the *claim* boundary,
  -- but the holder's run is the run they did — the same reason `036` leaves
  -- their perimeter and duration alone after a carve.
  claim_id uuid PRIMARY KEY REFERENCES territory_claims(id) ON DELETE CASCADE,

  -- The trimmed loop, and how far into the run each vertex was reached.
  -- Two parallel arrays with a constraint rather than one array of objects:
  -- the geometry is then a real geometry (PostGIS validates it, and
  -- `ST_AsGeoJSON` reads it back), and a length mismatch is impossible.
  path geometry(LineString, 4326) NOT NULL,
  elapsed_seconds integer[] NOT NULL,

  -- The trimmed figures, which are always less than the claim's own.
  distance_metres double precision NOT NULL CHECK (distance_metres > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  -- Recorded rather than assumed, so a row written under an older rule still
  -- says what was removed from it.
  trim_metres integer NOT NULL CHECK (trim_metres >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT territory_claim_ghost_traces_timing_matches_path
    CHECK (ST_NPoints(path) = array_length(elapsed_seconds, 1)),
  -- Four points is the floor `detectLoopClaim` uses before it will call a
  -- trace a loop, and fewer is not something anybody can pace against.
  CONSTRAINT territory_claim_ghost_traces_has_enough_points
    CHECK (ST_NPoints(path) >= 4)
);

-- --------------------------------------------------------------------------
-- Who looked, and when
-- --------------------------------------------------------------------------

-- `territory-guide.md`: "Rate limited to 3 ghost trace requests per user per
-- hour". This is the counter, and it is also the audit trail for a
-- privacy-sensitive read and the trigger for the holder's `GHOST_INCOMING`
-- notice (`notification-catalogue.ts`).
--
-- **No coordinates and no outcome.** A row says which account asked about
-- which claim and when. Whether they then went for a run is the run's own
-- record, under its own retention.
CREATE TABLE IF NOT EXISTS territory_claim_ghost_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES territory_claims(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The read the rate limit makes on every request: this account, last hour.
CREATE INDEX IF NOT EXISTS territory_claim_ghost_views_recent_idx
  ON territory_claim_ghost_views (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS territory_claim_ghost_views_claim_idx
  ON territory_claim_ghost_views (claim_id, created_at DESC);

-- --------------------------------------------------------------------------
-- The published numbers
-- --------------------------------------------------------------------------

-- Its own kind, not `territory_claim` version 3.
--
-- `territory-guide.md` is explicit that "Ghost Race is purely a motivational
-- UI layer — the contest rules are identical". Filing these under
-- `territory_claim` would supersede the carving rule `036` published, so
-- anybody reading the latest claim rule would find a row with no
-- `minCarveShare` in it and conclude the contest had changed. It has not.
ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'territory_claim', 'leaderboard', 'notification',
  'global_board', 'route_suggestion', 'ghost_race'
));

INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'ghost_race',
  1,
  '{"trimMetres": 200, "viewsPerHour": 3, "minPoints": 4, "levelSeconds": 5}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;

COMMENT ON TABLE territory_claim_ghost_traces IS
  'Trimmed, time-annotated loop for Ghost Race. Written at claim time; never the raw trace.';
COMMENT ON TABLE territory_claim_ghost_views IS
  'One row per ghost trace served. Enforces the hourly budget and records who asked.';
