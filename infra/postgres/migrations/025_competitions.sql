-- Scheduled competitions (Phase 3, milestone 3.6).
--
-- An opt-in, time-boxed event with a published rule version, stated
-- eligibility, a fixed window, cosmetic-only rewards, and a dispute period
-- (`gameplay.md`). It is pace-neutral like everything else: a competition
-- stores a mode, an Asia/Kolkata day window, and one integer score per
-- enrolled participant, and it never reads pace, distance, route, or location
-- (ADR-0005).
--
-- Two things this schema exists to protect:
--   1. Nobody is ever entered by somebody else. A competition is created by
--      staff, but a participant exists only because they enrolled themselves.
--   2. A result is written once, at the close of the window, and the dispute
--      period is a stated span during which it is provisional — not a licence
--      to rewrite it. `finalized_at` records that the span passed; the scores
--      do not change when it does (ADR-0006).

CREATE TABLE IF NOT EXISTS competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- The same pace-neutral modes every other contest uses. 'quest_completion'
  -- is absent for the same reason: nothing records a quest completion.
  mode text NOT NULL CHECK (mode IN ('active_minutes', 'active_days')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'published', 'open', 'closed', 'finalized', 'cancelled'
  )),
  -- The scoring window, in Kolkata days, fixed when the competition is
  -- created. Enrollment opens as soon as it is published and closes when the
  -- window does; the window itself never moves.
  period_start date NOT NULL,
  period_end date NOT NULL,
  CHECK (period_end > period_start),
  -- Published eligibility: the least amount of history an account must have to
  -- enter. Zero means open to everyone who enrolls, which is the honest
  -- default; a higher band exists so an event can be run for people who have
  -- been here a while without inventing a hidden filter. It is a count of
  -- earlier active weeks — never a score, a pace, or a place.
  min_prior_active_weeks integer NOT NULL DEFAULT 0
    CHECK (min_prior_active_weeks BETWEEN 0 AND 520),
  -- Cosmetic or status only in v1: no cash, physical prizes, or paid advantage
  -- (`product.md`). Stored as the published text members are shown.
  rewards text NOT NULL DEFAULT '' CHECK (char_length(rewards) <= 500),
  -- How long results stay provisional after the window closes.
  dispute_period_hours integer NOT NULL DEFAULT 48
    CHECK (dispute_period_hours BETWEEN 0 AND 8759),
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  closed_at timestamptz,
  finalized_at timestamptz,
  cancelled_at timestamptz
);

-- The member-facing list reads published competitions newest first; the worker
-- sweep reads the ones whose status is behind the clock.
CREATE INDEX IF NOT EXISTS competitions_visible_idx
  ON competitions (period_start DESC) WHERE status <> 'draft';
CREATE INDEX IF NOT EXISTS competitions_due_idx
  ON competitions (status, period_end)
  WHERE status IN ('published', 'open', 'closed');

-- Enrollment is the consent that puts a score in front of other participants,
-- so it is recorded rather than inferred, and withdrawing is a recorded
-- departure rather than a delete.
CREATE TABLE IF NOT EXISTS competition_enrollments (
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  PRIMARY KEY (competition_id, account_id)
);

CREATE INDEX IF NOT EXISTS competition_enrollments_live_idx
  ON competition_enrollments (competition_id) WHERE withdrawn_at IS NULL;

-- Written once by the worker when the window closes.
CREATE TABLE IF NOT EXISTS competition_results (
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0),
  -- Competition rank: equal scores share a rank and the next rank skips. Ties
  -- are shared rather than broken, because every available tiebreak would be
  -- pace, distance, or timing (ADR-0007).
  rank integer NOT NULL CHECK (rank >= 1),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, account_id)
);

-- Published competition rule v1, in the same shape as the 1v1 and club
-- challenge rules so the same parser and scoring functions read all three.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'competition',
  1,
  '{"dailyCapMinutes": 240, "minMinutesPerActiveDay": 1, "lengthDays": [7, 14, 30], "modes": ["active_minutes", "active_days"]}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
