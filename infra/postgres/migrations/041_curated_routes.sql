-- Curated running routes: the dataset route suggestions are drawn from
-- (`product.md` route suggestions; pending-work 3.1-3.3).
--
-- **A suggestion is a whole loop somebody reviewed, not a path assembled from
-- segments.** `product.md` says the system "generates a loop shape ... using
-- curated public MMR paths", and this stores reviewed loops instead, because
-- generating one needs something this deployment does not have:
--
--   * No routing engine is operational. Valhalla sits in `compose.yaml` with
--     `serve_tiles: False` and no tile URLs.
--   * No map of runnable ground exists — pavements, crossings, which roads are
--     safe after dark. `territory-recommendation.ts` already refused to invent
--     routes for exactly this reason: "a generated line across a motorway would
--     be worse than no suggestion at all".
--
-- And a deeper reason than either: a loop assembled from reviewed segments is
-- **not itself reviewed**. `product.md` requires that the system "never suggests
-- routes through unverified or private land", and a combination nobody looked at
-- cannot carry that promise. So a human publishes a loop, and the algorithm
-- chooses among published loops. Choosing is a safe operation; splicing is not.
--
-- What the app calls "reduce the distance" therefore picks a shorter published
-- loop nearby rather than tightening a line. `map-ux.md` already asks for that
-- shape of behaviour: "each suggestion is a different loop shape, not just a
-- scaled version of the same one."
--
-- **The table ships empty.** Populating it is a data-and-review task, not a code
-- one, and the API answers `no_curated_routes` until somebody does it. That is
-- the same treatment FCM, email, and the geocoder get: built, tested, and honest
-- about being unconfigured.

CREATE TABLE IF NOT EXISTS curated_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable across re-imports, like `curated_places.stable_key` (`008`).
  stable_key text NOT NULL UNIQUE CHECK (char_length(stable_key) BETWEEN 1 AND 160),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- Loops around the same ground share a family, and a suggestion set offers at
  -- most one per family: three variants of one park is one idea shown thrice.
  family_key text NOT NULL CHECK (char_length(family_key) BETWEEN 1 AND 160),

  -- The loop itself, and where it begins. A closed line: the last point is the
  -- first, which is what makes it a loop rather than a route somewhere.
  path geometry(LineString, 4326) NOT NULL,
  start_point geometry(Point, 4326) NOT NULL,
  -- Stored rather than computed on read: the published number is what a runner
  -- was shown, and `ST_Length` on a simplified line would drift from it.
  distance_metres double precision NOT NULL
    CHECK (distance_metres BETWEEN 1000 AND 10000),

  -- The place tags the boards already group by (`038`), so a suggestion can be
  -- scoped without a second geography.
  city_tag text NOT NULL CHECK (char_length(city_tag) BETWEEN 1 AND 80),
  country_tag text NOT NULL CHECK (country_tag ~ '^[A-Z]{2}$'),

  -- What makes a loop safe to suggest at all, and none of it is optional. A
  -- reviewer has to have an opinion on each, because "we did not record whether
  -- this crosses traffic" is not a route anybody should be sent on after dark.
  surface text NOT NULL CHECK (surface IN ('paved', 'track', 'trail', 'mixed')),
  lit boolean NOT NULL,
  traffic_exposure text NOT NULL CHECK (traffic_exposure IN ('none', 'low', 'moderate')),
  accessibility text NOT NULL CHECK (accessibility IN ('step-free', 'mixed', 'unknown')),

  -- Provenance, in the shape `008` uses for places.
  provenance jsonb NOT NULL,

  -- The review. Nullable so a draft can exist, and constrained below so a
  -- published route cannot.
  reviewed_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 500),

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'withdrawn')),
  published_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text
    CHECK (withdrawn_reason IS NULL OR char_length(withdrawn_reason) BETWEEN 1 AND 300),

  -- `product.md` requires volatile data to be revalidated every 30 days and
  -- unpublished on a confirmed closure. A route past this date stops being
  -- suggested without anybody having to remember to withdraw it.
  revalidate_after timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- The invariant the whole table exists for: nothing reaches a runner that a
  -- person did not review and sign.
  CONSTRAINT curated_routes_published_is_reviewed CHECK (
    status <> 'published'
    OR (reviewed_at IS NOT NULL AND reviewed_by_account_id IS NOT NULL
        AND published_at IS NOT NULL)
  ),
  -- A withdrawal has to say when and why. `product.md` requires a route to be
  -- unpublished "immediately on confirmed closure report", and a route pulled
  -- from circulation with no recorded reason leaves the next reviewer unable to
  -- tell a closed park from a bad crossing from an admin mistake.
  CONSTRAINT curated_routes_withdrawn_has_a_reason CHECK (
    (status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL)
  )
);

-- Suggestions are read by "near this point, in this distance band, published
-- and still fresh".
CREATE INDEX IF NOT EXISTS curated_routes_suggestable_idx
  ON curated_routes USING gist (start_point)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS curated_routes_band_idx
  ON curated_routes (city_tag, distance_metres)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS curated_routes_stale_idx
  ON curated_routes (revalidate_after)
  WHERE status = 'published';

-- --------------------------------------------------------------------------
-- What happened to a suggestion
-- --------------------------------------------------------------------------

-- `product.md`: the engine "learns from completed, skipped, and declined runs,
-- without treating pace as a quality signal", and the telemetry list includes
-- "route suggestion impressions, distance/time adjustments".
--
-- **No coordinates and no pace.** A row says which reviewed loop was offered
-- and what the person did about it. That is enough to stop offering something
-- they keep declining, and it is not a record of where they went — the run
-- itself already carries that, under its own retention.
CREATE TABLE IF NOT EXISTS route_suggestion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES curated_routes(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('shown', 'accepted', 'declined', 'completed')),
  -- Set when the person asked for a different distance or a time budget, so
  -- "adjustments" is answerable without storing what they typed.
  adjusted_to_metres double precision
    CHECK (adjusted_to_metres IS NULL OR adjusted_to_metres BETWEEN 1000 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS route_suggestion_events_account_idx
  ON route_suggestion_events (account_id, created_at DESC);

-- Declines are the read the ranker makes on every request.
CREATE INDEX IF NOT EXISTS route_suggestion_events_declined_idx
  ON route_suggestion_events (account_id, route_id)
  WHERE action = 'declined';

-- --------------------------------------------------------------------------
-- The published balance numbers
-- --------------------------------------------------------------------------

ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'territory_claim', 'leaderboard', 'notification',
  'global_board', 'route_suggestion'
));

-- Every number from `product.md`'s suggestion guardrails, in one reviewed place
-- so changing a balance decision is a migration rather than a deploy.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'route_suggestion',
  1,
  '{"maxSuggestions": 3, "minDistanceMetres": 1000, "maxDistanceMetres": 10000,
    "newRunnerBandMetres": [2000, 4000], "startWithinMetres": 1500,
    "highLoadRatio": 1.5, "defaultPaceSecondsPerKm": 360,
    "declineCooldownDays": 30}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
