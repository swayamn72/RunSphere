-- Two product decisions taken on 2026-09-06, closed in the schema.
--
--   1. **RunSphere is running only.** Walking and hiking are out of scope
--      (`product.md`: "Its first-class and only activity type is running").
--      `001` has allowed three movement types since the first migration.
--
--   2. **The friend board is automatic.** `gameplay.md`: "there is no separate
--      'join board' toggle — friendship is the sole gate". The `friends` scope
--      in `leaderboard_opt_ins` has no reader any more.

-- --------------------------------------------------------------------------
-- Running only
-- --------------------------------------------------------------------------

-- Existing rows first, because the constraint below cannot be added while any
-- row violates it.
--
-- **These are converted, not deleted, and the count is reported.** A recorded
-- activity is something somebody did; deleting it to satisfy a constraint would
-- be destroying their history to tidy up ours. Converting is not perfect either
-- — it relabels a walk as a run — but the distance, duration, and trace are
-- untouched, and in a running-only product `movement_type` has exactly one
-- meaningful value. Android v1 has not shipped, so in practice this touches
-- development records only; the notice is there so it is not silent if it ever
-- touches more.
DO $$
DECLARE relabelled bigint;
BEGIN
  UPDATE activity_submissions SET movement_type = 'run'
    WHERE movement_type <> 'run';
  GET DIAGNOSTICS relabelled = ROW_COUNT;
  IF relabelled > 0 THEN
    RAISE NOTICE 'running-only: relabelled % activity submission(s) from walk/hike to run', relabelled;
  END IF;
END $$;

ALTER TABLE activity_submissions DROP CONSTRAINT IF EXISTS activity_submissions_movement_type_check;
ALTER TABLE activity_submissions
  ADD CONSTRAINT activity_submissions_movement_type_check CHECK (movement_type = 'run');

-- The column is kept rather than dropped, even though it now has one legal
-- value. It costs a byte and it says what the row is; dropping it would ripple
-- through the contracts, the mobile local database, and every read path to
-- remove a field that documents the record. If a second activity type is ever
-- approved, this constraint is the only thing that has to move.
COMMENT ON COLUMN activity_submissions.movement_type IS
  'Always ''run''. RunSphere is running-only (product.md, 2026-09-06); the column is retained so a future type is a constraint change rather than a schema change.';

-- --------------------------------------------------------------------------
-- The friend board needs no opt-in
-- --------------------------------------------------------------------------

-- **Existing rows are revoked, not deleted.** `019` chose revocation over
-- deletion so the opt-in history stays auditable, and that reasoning does not
-- stop applying because the product changed its mind: an account that joined
-- the board did so, and the record of when says why their name appeared.
--
-- Revoking rather than leaving them live also keeps the table honest. A live
-- row means "on that board", and nothing reads the friends scope any more, so
-- leaving them would assert something no longer true.
UPDATE leaderboard_opt_ins
  SET revoked_at = coalesce(revoked_at, now())
  WHERE scope = 'friends' AND revoked_at IS NULL;

-- The scope stays in the CHECK. Narrowing it would make the revoked rows above
-- illegal and force the deletion this migration just declined to do — and the
-- global board, which ADR-0007 does require an opt-in for, still uses the same
-- table.
COMMENT ON TABLE leaderboard_opt_ins IS
  'Per-scope board opt-ins (ADR-0007). The ''friends'' scope is historical: the friend board became automatic on 2026-09-06 (gameplay.md) and nothing reads it. ''global'' is live.';
