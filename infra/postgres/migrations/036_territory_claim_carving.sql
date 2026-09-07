-- Turf carving: H3 cell sets, effort-graced speed contests, monthly seasons
-- (territory-guide.md v3; ADR-0011).
--
-- `031`-`035` shipped a whole-claim takeover: enough overlap made a contest, and
-- the shorter `duration_seconds` took the entire polygon. This replaces the
-- contest without replacing the table.
--
-- Three changes worth reading before the DDL:
--
--   1. **Ground is held as H3 cells, not as a polygon.** `boundary` stays, and
--      is now a *drawing* of `h3_cell_set` rather than the record of what is
--      held. Carving a polygon means intersecting geometry and hoping the result
--      is still a simple ring; intersecting two sorted arrays of cell indexes is
--      a set operation with no failure mode. Area follows the cell count.
--
--   2. **The contest is speed, not time.** Perimeter divided by duration, with
--      an effort allowance for the longer loop, capped at 15%. This is why the
--      two `CHECK` constraints dropped below have to go: both assert that the
--      winner's *duration* was shorter, and under the new rule the winner of a
--      contest can have been running for four times as long.
--
--   3. **Claims belong to a month.** `season_month` scopes every contest and
--      every board to the current Asia/Kolkata month, which is the reset cycle.
--      Nothing here deletes an expired claim; the map filters by month.
--
-- **`perimeter_metres` is not added.** The plan asks for it, but `032` already
-- added `distance_metres` for exactly this quantity ("the length of the closed
-- loop"), and it is already written on every claim. A second column holding the
-- same metres would need keeping in sync forever, so `distance_metres` is
-- backfilled, constrained, and made NOT NULL instead. Read it as the perimeter.

-- --------------------------------------------------------------------------
-- Ground, as cells
-- --------------------------------------------------------------------------

ALTER TABLE territory_claims
  -- The resolution this claim's cells were computed at. Stored per row so
  -- raising it later re-scores nothing that has already been decided.
  ADD COLUMN IF NOT EXISTS h3_resolution smallint NOT NULL DEFAULT 11
    CHECK (h3_resolution BETWEEN 0 AND 15),
  -- The ground held, as H3 indexes. Sorted on write: the order is a property of
  -- the ground rather than of the run, which is the same reason `boundary` is
  -- rotated to its westernmost vertex — an array in the order somebody ran it
  -- begins at their front door.
  ADD COLUMN IF NOT EXISTS h3_cell_set text[] NOT NULL DEFAULT '{}',
  -- The pinned library that produced those cells (ADR-0001), so a disputed
  -- carve can be recomputed by the code that decided it. Null only while the
  -- cell set is empty, which is true of every claim written before this
  -- migration and of nothing written after it.
  ADD COLUMN IF NOT EXISTS h3_version text
    CHECK (h3_version IS NULL OR char_length(h3_version) BETWEEN 1 AND 32),
  -- The claim this one carved its largest piece out of. Distinct from
  -- `lineage_id`, which follows a whole piece of ground through every owner it
  -- has had; this names the single claim that lost the most cells to this one.
  ADD COLUMN IF NOT EXISTS parent_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL,
  -- `YYYY-MM` in Asia/Kolkata. Char, not date: a month is what it is, and
  -- storing the 1st would invite somebody to compare it with a timestamp.
  ADD COLUMN IF NOT EXISTS season_month char(7);

-- A cell set without the version that made it cannot be recomputed, and a
-- version without cells is a label on nothing.
ALTER TABLE territory_claims
  DROP CONSTRAINT IF EXISTS territory_claims_h3_version_accompanies_cells;
ALTER TABLE territory_claims
  ADD CONSTRAINT territory_claims_h3_version_accompanies_cells
    CHECK ((h3_cell_set = '{}') = (h3_version IS NULL));

-- Existing claims get their month from when they were claimed, in the timezone
-- the reset runs in. They keep an empty cell set: nothing in the database can
-- turn a polygon into H3 cells (there is no `h3` extension here), so the API
-- computes it the first time such a claim is contested. See
-- `territory-claim-routes.ts`, which finds candidates by `boundary &&` as well
-- as by `h3_cell_set &&` for exactly this reason.
UPDATE territory_claims
  SET season_month = to_char(claimed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
  WHERE season_month IS NULL;

ALTER TABLE territory_claims ALTER COLUMN season_month SET NOT NULL;

ALTER TABLE territory_claims
  DROP CONSTRAINT IF EXISTS territory_claims_season_month_shape;
ALTER TABLE territory_claims
  ADD CONSTRAINT territory_claims_season_month_shape
    CHECK (season_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- --------------------------------------------------------------------------
-- Perimeter: the numerator of every speed in this mechanic
-- --------------------------------------------------------------------------

-- Rows from before `032` have no distance. `ST_Perimeter` on the stored
-- boundary is not what the runner covered — the boundary is simplified — but it
-- is the only number available for a claim whose trace may already be purged,
-- and it is within a few percent for a loop of this size.
UPDATE territory_claims
  SET distance_metres = ST_Perimeter(boundary::geography)
  WHERE distance_metres IS NULL;

-- `area_sqm > 0` has been enforced since `031`, and a polygon with positive
-- area has a positive perimeter, so the backfill above cannot leave a zero.
-- Assert it rather than assume it: a zero perimeter is a zero speed, which
-- would make the claim untakeable by anybody for the rest of the season.
-- **This stops the migration; it does not delete anybody's ground.**
DO $$
DECLARE broken bigint;
BEGIN
  SELECT count(*) INTO broken FROM territory_claims
    WHERE distance_metres IS NULL OR distance_metres <= 0;
  IF broken > 0 THEN
    RAISE EXCEPTION
      'territory_claims: % row(s) have no usable perimeter; fix them before carving goes live', broken;
  END IF;
END $$;

ALTER TABLE territory_claims ALTER COLUMN distance_metres SET NOT NULL;

-- --------------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------------

-- Overlap is an array intersection now, so the contest query needs GIN. Not
-- partial on `released_at`: GIN does not support the predicate cheaply here and
-- the live filter is selective enough on its own.
CREATE INDEX IF NOT EXISTS territory_claims_cell_set_idx
  ON territory_claims USING gin (h3_cell_set);

-- Boards and the map read one month at a time.
CREATE INDEX IF NOT EXISTS territory_claims_season_live_idx
  ON territory_claims (season_month, area_sqm DESC)
  WHERE released_at IS NULL;

-- --------------------------------------------------------------------------
-- The two constraints that block the new rule
-- --------------------------------------------------------------------------

-- `031` asserted the winner's duration was strictly shorter. Under effort
-- grace, a challenger who ran 4 km in 20 minutes can take ground from a holder
-- who ran 1 km in 4:30 — the winner's duration is four times longer. The
-- replacement asserts the thing that is actually true of a carve: the
-- challenger's grace-adjusted speed beat the holder's.
ALTER TABLE territory_claim_takeovers
  DROP CONSTRAINT IF EXISTS territory_claim_takeovers_is_faster;

ALTER TABLE territory_claim_takeovers
  -- A takeover is now usually a carve: part of the ground, not all of it.
  --
  -- The default is `takeover` and not `carve` because the only rows it can ever
  -- apply to are the ones already in this table, and every one of those was
  -- written under the old rule that took the whole claim. The route always
  -- passes this column explicitly, so nothing written from here on relies on
  -- the default at all.
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'takeover'
    CHECK (kind IN ('takeover', 'carve')),
  -- What actually changed hands, from the intersected cell sets.
  ADD COLUMN IF NOT EXISTS carved_area_sqm double precision
    CHECK (carved_area_sqm IS NULL OR carved_area_sqm > 0),
  ADD COLUMN IF NOT EXISTS carved_cell_count integer
    CHECK (carved_cell_count IS NULL OR carved_cell_count > 0),
  -- Whether the holder kept anything. A carve that takes everything is
  -- indistinguishable from the old whole-claim takeover, and is recorded as one.
  ADD COLUMN IF NOT EXISTS holder_survived boolean NOT NULL DEFAULT false,
  -- The decision, in full, so a disputed carve can be replayed from this row
  -- alone rather than from two claims that may since have changed again.
  ADD COLUMN IF NOT EXISTS effort_ratio double precision
    CHECK (effort_ratio IS NULL OR effort_ratio >= 0),
  ADD COLUMN IF NOT EXISTS grace_applied double precision
    CHECK (grace_applied IS NULL OR grace_applied BETWEEN 0 AND 0.15),
  ADD COLUMN IF NOT EXISTS effective_speed_mps double precision
    CHECK (effective_speed_mps IS NULL OR effective_speed_mps >= 0),
  ADD COLUMN IF NOT EXISTS holder_speed_mps double precision
    CHECK (holder_speed_mps IS NULL OR holder_speed_mps >= 0);

-- The rule of the mechanic, enforced. Only checked once the speeds are present,
-- so the rows `031` and `033` wrote under the old rule stay valid history.
ALTER TABLE territory_claim_takeovers
  DROP CONSTRAINT IF EXISTS territory_claim_takeovers_won_on_speed;
ALTER TABLE territory_claim_takeovers
  ADD CONSTRAINT territory_claim_takeovers_won_on_speed
    CHECK (
      effective_speed_mps IS NULL OR holder_speed_mps IS NULL
      OR effective_speed_mps > holder_speed_mps
    );

-- The mirror-image problem in `034`: a failed challenger was asserted to have
-- taken *longer* than the holder. A challenger can now lose while finishing
-- sooner, because their loop was shorter and their speed lower once grace is
-- accounted for.
ALTER TABLE territory_claim_attempts
  DROP CONSTRAINT IF EXISTS territory_claim_attempts_did_not_beat;

ALTER TABLE territory_claim_attempts
  ADD COLUMN IF NOT EXISTS effort_ratio double precision
    CHECK (effort_ratio IS NULL OR effort_ratio >= 0),
  ADD COLUMN IF NOT EXISTS grace_applied double precision
    CHECK (grace_applied IS NULL OR grace_applied BETWEEN 0 AND 0.15),
  ADD COLUMN IF NOT EXISTS effective_speed_mps double precision
    CHECK (effective_speed_mps IS NULL OR effective_speed_mps >= 0),
  ADD COLUMN IF NOT EXISTS holder_speed_mps double precision
    CHECK (holder_speed_mps IS NULL OR holder_speed_mps >= 0),
  -- Why the challenge failed: they were slower, or the overlap was too small to
  -- be worth contesting. The second is not a defeat and should not read as one.
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'slower'
    CHECK (outcome IN ('slower', 'overlap_too_small'));

ALTER TABLE territory_claim_attempts
  DROP CONSTRAINT IF EXISTS territory_claim_attempts_lost_on_speed;
ALTER TABLE territory_claim_attempts
  ADD CONSTRAINT territory_claim_attempts_lost_on_speed
    CHECK (
      outcome <> 'slower'
      OR effective_speed_mps IS NULL OR holder_speed_mps IS NULL
      OR effective_speed_mps <= holder_speed_mps
    );

-- --------------------------------------------------------------------------
-- The published balance numbers
-- --------------------------------------------------------------------------

-- Version 2 of the claim rule. `takeoverOverlapRatio` is gone — there is no
-- single overlap threshold any more, because the overlap is carved rather than
-- won whole — and the H3 resolution, carve floor, and grace curve join it.
--
-- `h3Resolution` is 11 because the plan's schema says 11. Note that the same
-- plan calls resolution 11 "~15 m² per cell" and it is ~1,963 m²; at this
-- resolution the 5,000 m² carve floor is about two and a half cells. Resolution
-- 12 (~280 m²) would make a carve legible at roughly seven times the stored
-- cells per claim. Changing it is this migration's successor, not a deploy.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'territory_claim',
  2,
  '{"closeWithinMetres": 60, "minAreaSqm": 5000, "maxAreaSqm": 5000000, "maxBoundaryPoints": 128, "h3Resolution": 11, "minCarveShare": 0.1, "gracePerEffortMultiple": 0.05, "maxEffortGrace": 0.15}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
