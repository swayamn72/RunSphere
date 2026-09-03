-- Asynchronous 1v1 friend challenges (ADR-0005, ADR-0007). A challenge is
-- pace-neutral and cosmetic: it stores a mode, a Kolkata-day window, and one
-- integer score per participant. It never stores or reads pace, speed,
-- distance, route geometry, or location, and it never affects eligibility,
-- validation, or territory value.
--
-- Scoring runs in the worker from server-derived activity only (ADR-0006).
-- The invariant this schema exists to protect: status 'finished' implies a
-- challenge_results row, so a finished challenge can never present an empty or
-- half-computed result.

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('active_minutes', 'active_days', 'quest_completion')),
  length_days integer NOT NULL CHECK (length_days BETWEEN 1 AND 31),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN (
    'invited', 'accepted', 'declined', 'active', 'finished', 'cancelled'
  )),
  challenger_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  opponent_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_version text NOT NULL CHECK (char_length(rule_version) BETWEEN 1 AND 64),
  -- Proposed at invite time and rewritten exactly once, on accept, so both
  -- participants are scored over the same window starting the day they agreed.
  -- Application code only ever updates these while status = 'invited'.
  period_start date NOT NULL,
  period_end date NOT NULL,
  invite_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  finished_at timestamptz,
  CHECK (challenger_account_id <> opponent_account_id),
  CHECK (period_end = period_start + length_days)
);

-- One live challenge per pair, in either direction, so an invite cannot be used
-- to spam someone and scores cannot double-count a window.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_open_pair_idx ON challenges (
  least(challenger_account_id, opponent_account_id),
  greatest(challenger_account_id, opponent_account_id)
) WHERE status IN ('invited', 'accepted', 'active');

CREATE INDEX IF NOT EXISTS challenges_participant_idx
  ON challenges (challenger_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_opponent_idx
  ON challenges (opponent_account_id, created_at DESC);
-- Supports the worker sweep for windows that have closed and invites that lapsed.
CREATE INDEX IF NOT EXISTS challenges_due_idx
  ON challenges (status, period_end) WHERE status IN ('invited', 'active');

CREATE TABLE IF NOT EXISTS challenge_results (
  challenge_id uuid PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  rule_version text NOT NULL CHECK (char_length(rule_version) BETWEEN 1 AND 64),
  -- NULL is an explicit tie. A tie is never broken on pace, time, or distance.
  winner_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_participant_results (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0),
  PRIMARY KEY (challenge_id, account_id)
);

-- Version-1 challenge rule. camelCase to match the @runsphere/domain
-- ChallengeRule parser; unsuperseded until we publish v2.
--
-- `modes` deliberately omits 'quest_completion'. Nothing in the schema records
-- that an account completed a quest, so scoring that mode would produce a
-- fabricated 0-0 tie for every pair. It joins this list in the same change that
-- starts recording completions.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'challenge',
  1,
  '{"dailyCapMinutes": 240, "minMinutesPerActiveDay": 1, "lengthDays": [3, 7], "modes": ["active_minutes", "active_days"]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
