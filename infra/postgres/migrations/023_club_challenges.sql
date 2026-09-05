-- Club challenges (Phase 3, milestone 3.4).
--
-- The competitive counterpart to the cooperative relay, and the club-scoped
-- counterpart to the 1v1 challenge in 018. A club challenge is a time-boxed,
-- member-only contest inside exactly one club: it stores a mode, an
-- Asia/Kolkata day window, and one integer score per participant. It never
-- stores or reads pace, speed, distance, route geometry, or location, and it
-- never affects eligibility, validation, or territory value (ADR-0005).
--
-- Two rules this schema exists to protect:
--   1. Participation is per challenge and explicit. A member of the club is not
--      in the challenge until they join it, so nobody's score is published to
--      the club by somebody else's decision to open a contest.
--   2. A finished challenge has an immutable result. Scoring runs in the worker
--      from server-derived activity only, once, in the transaction that marks
--      the challenge finished (ADR-0006).

CREATE TABLE IF NOT EXISTS club_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- The same pace-neutral modes the 1v1 rule enables. 'quest_completion' is
  -- absent for the same reason it is absent there: nothing records that an
  -- account completed a quest, so the mode would score every member zero.
  mode text NOT NULL CHECK (mode IN ('active_minutes', 'active_days')),
  length_days integer NOT NULL CHECK (length_days BETWEEN 1 AND 31),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'cancelled')),
  -- Fixed at creation and never rewritten: everyone is scored over the same
  -- window, whenever they joined it.
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- The rule the challenge was opened under. A later rule version supersedes it
  -- and never rescores a window the participants already ran.
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (period_end = period_start + length_days)
);

-- One live challenge per club. A member is never asked which of two contests
-- their minutes count toward, and "the club's challenge" is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS club_challenges_open_idx
  ON club_challenges (club_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS club_challenges_club_idx
  ON club_challenges (club_id, period_start DESC);
-- Supports the worker sweep for windows that have closed.
CREATE INDEX IF NOT EXISTS club_challenges_due_idx
  ON club_challenges (status, period_end) WHERE status = 'active';

-- Joining is the act that publishes a score to the club, so it is recorded
-- rather than inferred from membership. Leaving revokes it and is never a
-- delete: the row stays as the audited record that the member was in and left.
CREATE TABLE IF NOT EXISTS club_challenge_participants (
  challenge_id uuid NOT NULL REFERENCES club_challenges(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (challenge_id, account_id)
);

CREATE INDEX IF NOT EXISTS club_challenge_participants_live_idx
  ON club_challenge_participants (challenge_id) WHERE left_at IS NULL;

-- Written once by the worker when the window closes. A rank is stored beside
-- the score so a finished challenge reads the same to everyone forever, even
-- after the membership it was run in changes.
CREATE TABLE IF NOT EXISTS club_challenge_results (
  challenge_id uuid NOT NULL REFERENCES club_challenges(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0),
  -- Competition rank: equal scores share a rank and the next rank skips. Ties
  -- are shared rather than broken, because every available tiebreak would be
  -- pace, distance, or timing (ADR-0007).
  rank integer NOT NULL CHECK (rank >= 1),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, account_id)
);

-- `011` constrained `rule_versions.kind` to the kinds that existed then, and
-- this milestone publishes a new one. The constraint is widened here, before
-- the seed below, because the seed would otherwise fail on first apply — as
-- would `024`'s `global_board` seed, so both new kinds are added together
-- rather than leaving the next migration to trip over the same wall.
--
-- Dropping by the name Postgres generates for an inline column CHECK, then
-- re-adding it under that same name, so the constraint keeps one identity
-- however many times it is widened.
ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'leaderboard', 'notification', 'global_board'
));

-- Published club-challenge rule v1, in the same shape as the 1v1 'challenge'
-- rule so the same parser and the same scoring functions read both. A club
-- challenge runs a week or a fortnight: shorter than that rewards a single
-- unusual day, longer outlasts the interest of the club.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'club_challenge',
  1,
  '{"dailyCapMinutes": 240, "minMinutesPerActiveDay": 1, "lengthDays": [7, 14], "modes": ["active_minutes", "active_days"]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
