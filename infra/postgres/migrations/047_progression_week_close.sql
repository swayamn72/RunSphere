-- Progression week close (B2).
--
-- Activity XP is finalized per closed Asia/Kolkata week (ADR-0005, ADR-0006).
-- Until now the only writer was `POST /v1/progression/sync`, which no client
-- calls, so every closed week's XP was never persisted and each runner's total
-- and level fell back every Monday to whatever the new week projected.
--
-- The worker now finalizes closed weeks itself, oldest first, and records here
-- when a week has been finalized for every account that ran in it, so the job
-- is state-driven: an idle sweep reads one row.
--
-- Additive and nullable: no backfill needed. Existing rows (written by the sync
-- route) are simply "not yet finalized" and are picked up on the first sweep;
-- grants are idempotent on (account_id, dedupe_key), so nothing is doubled.
-- Rollback: drop the column; the job then re-finalizes idempotently.

ALTER TABLE weekly_periods
  ADD COLUMN IF NOT EXISTS progression_finalized_at timestamptz;
