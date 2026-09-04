-- Club relays (Phase 3, milestone 3.2).
--
-- A relay is one weekly cooperative target per club: members contribute capped
-- validated active minutes, and the club sees the shared total against the
-- target. It is pace-neutral and cosmetic (ADR-0005) and weekly like every
-- other period in the system (ADR-0006).
--
-- The privacy shape this schema exists to protect: a per-member contribution
-- row is written by the worker so the total is auditable and recomputable, but
-- **no route returns one**. A club reads aggregates; a member reads the
-- aggregate plus their own row (`safety-and-privacy.md`).

CREATE TABLE IF NOT EXISTS club_relays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Monday-based Asia/Kolkata week, the same period identity every other
  -- weekly record uses.
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end = period_start + 7),
  target_units integer NOT NULL CHECK (target_units BETWEEN 1 AND 1000000),
  -- The rule the target was set under. A later rule change supersedes it and
  -- never rewrites a week that has already been scored.
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One relay per club per week: a second target for the same week would make
  -- "the club's progress" ambiguous.
  UNIQUE (club_id, period_start)
);

CREATE INDEX IF NOT EXISTS club_relays_club_period_idx
  ON club_relays (club_id, period_start DESC);

-- Recomputed by the worker from server-derived activity. Never written by a
-- client, and never read back out through a route.
CREATE TABLE IF NOT EXISTS club_relay_contributions (
  relay_id uuid NOT NULL REFERENCES club_relays(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (relay_id, account_id)
);

-- The one aggregate read: sum and count for a relay.
CREATE INDEX IF NOT EXISTS club_relay_contributions_relay_idx
  ON club_relay_contributions (relay_id) WHERE units > 0;

-- Published club-relay rule v1. The per-member weekly ceiling is what makes a
-- relay cooperative instead of a race: 600 minutes is ten hours, so a club
-- target above that cannot be reached by one person alone.
INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'club',
  1,
  '{"dailyCapMinutes": 240, "memberWeeklyCapMinutes": 600, "minTargetUnits": 60, "maxTargetUnits": 20000}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
