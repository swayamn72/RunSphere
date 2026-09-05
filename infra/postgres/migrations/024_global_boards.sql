-- Global period boards (Phase 3, milestone 3.5; ADR-0006, ADR-0007).
--
-- The widest audience in the product, and therefore the narrowest record: one
-- account, one Monday-based Asia/Kolkata week, one capped pace-neutral score,
-- one rank, and the published cohort band it was ranked in. No location, no
-- route, no timestamps, no pace, no distance.
--
-- The board is *materialized* rather than computed per request. Ranking every
-- opted-in account on every read would scan the whole activity history of
-- everyone on the board; the worker instead recomputes the open week and the
-- week just closed, and a read is one indexed page. PostgreSQL stays
-- authoritative and the table is rebuildable from activity at any time
-- (`gameplay.md`), which is what keeps a cache out of the critical path.

CREATE TABLE IF NOT EXISTS global_board_entries (
  -- Monday-based Asia/Kolkata week, the same period identity every other
  -- weekly record uses.
  period_start date NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The published cohort band this account was ranked in for this period.
  -- Stored rather than derived on read, so a finished week keeps the divisions
  -- it was actually scored under even after the rule changes.
  division text NOT NULL CHECK (char_length(division) BETWEEN 1 AND 32),
  score integer NOT NULL CHECK (score >= 0),
  -- Competition rank *within the division*: equal scores share a rank and the
  -- next rank skips. Ties are shared rather than broken, because every
  -- available tiebreak would be pace, distance, or timing (ADR-0007).
  rank integer NOT NULL CHECK (rank >= 1),
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_start, account_id)
);

-- The one read the API makes: a page of one division of one week, in order.
CREATE INDEX IF NOT EXISTS global_board_entries_page_idx
  ON global_board_entries (period_start, division, rank);

-- Published global-board rule v1. The `global_board` kind was added to the
-- `rule_versions.kind` constraint by `023`, which is the first migration that
-- needed to widen it; this seed depends on that having run.
--
-- `divisions` are activity-history bands, not skill ratings: they are derived
-- from how many earlier weeks an account was active, so a first week is never
-- ranked against a fiftieth (`product.md` newcomer treatment). The last band
-- omits `maxPriorActiveWeeks` and catches everyone above the others.
--
-- `minScore` keeps accounts that did not move this week off the board
-- entirely: a list of names against zero would publish participation without
-- publishing anything worth reading.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'global_board',
  1,
  '{"dailyCapMinutes": 240, "pageSize": 50, "minScore": 1, "divisions": [{"key": "newcomer", "maxPriorActiveWeeks": 0}, {"key": "rising", "maxPriorActiveWeeks": 3}, {"key": "established"}]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
