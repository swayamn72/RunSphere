-- Cosmetic progression XP ledger (ADR-0005). Grants are finalized once per
-- Asia/Kolkata week from server-derived activity (ADR-0006 immutable
-- snapshots); deleting a source activity never erases already-finalized XP.
-- This migration deliberately holds only the ledger + the version-1 rule;
-- achievements and weekly-reset mechanics arrive in later Phase 2 slices.

CREATE TABLE IF NOT EXISTS xp_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN (
    'active_minutes', 'quest_completion', 'active_day_consistency', 'achievement'
  )),
  amount integer NOT NULL CHECK (amount > 0),
  rule_version text NOT NULL CHECK (char_length(rule_version) BETWEEN 1 AND 64),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  period_start date NOT NULL,
  activity_id uuid REFERENCES activity_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS xp_entries_account_period_idx
  ON xp_entries (account_id, period_start DESC);

-- Version-1 progression rule. The definition is camelCase to match the
-- @runsphere/contracts ProgressionRule schema; unsuperseded until we publish v2.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'progression',
  1,
  '{"xpPerActiveMinute": 1, "xpPerActiveDay": 20, "dailyCapMinutes": 240, "minMinutesPerActiveDay": 1, "goalActiveDays": 3, "levels": [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
