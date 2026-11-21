-- Independent run modes (M9 tasks 9.1-9.4).
--
-- A run is now recorded in one of four modes, chosen before it starts:
-- free (stats only), turf (may claim ground), quest (may complete the one quest
-- it was started for) and ghost (races one rival claim, and may claim). The
-- server enforces what each mode can do; see activity-routes.ts,
-- territory-claim-routes.ts and quest-core.ts.
--
-- Runs recorded before this migration, and by app builds that predate it,
-- have run_mode NULL and keep the old behaviour (claimable, and checked
-- against every accepted quest), so nothing in flight changes.
--
-- quest_version_id and ghost_claim_id only ever sit on runs of their own
-- mode. They are SET NULL if the quest version or claim row is deleted: the
-- run stays, it just no longer points at it.
--
-- Rollback: additive. Older builds ignore the columns. To undo, drop the
-- constraint and ALTER TABLE activity_submissions DROP COLUMN IF EXISTS
-- run_mode, quest_version_id, ghost_claim_id once no build reads them.

ALTER TABLE activity_submissions
  ADD COLUMN IF NOT EXISTS run_mode text
    CHECK (run_mode IS NULL OR run_mode IN ('free', 'turf', 'quest', 'ghost')),
  ADD COLUMN IF NOT EXISTS quest_version_id uuid REFERENCES quest_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ghost_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_submissions_mode_targets'
  ) THEN
    ALTER TABLE activity_submissions ADD CONSTRAINT activity_submissions_mode_targets
      CHECK ((quest_version_id IS NULL OR run_mode = 'quest')
        AND (ghost_claim_id IS NULL OR run_mode = 'ghost'));
  END IF;
END $$;
