-- Pace-neutral cosmetic achievements (ADR-0005). Definitions are versioned and
-- superseded without rewriting award history; awards are once-per-account and
-- never deleted when a source activity is removed. Conditions read only
-- server-derived, capped, non-pace metrics.

CREATE TABLE IF NOT EXISTS achievement_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 80),
  rule_version text NOT NULL CHECK (char_length(rule_version) BETWEEN 1 AND 64),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(description) <= 500),
  condition jsonb NOT NULL,
  reward_xp integer NOT NULL CHECK (reward_xp >= 0),
  published_at timestamptz,
  superseded_at timestamptz,
  UNIQUE (key, rule_version)
);
CREATE INDEX IF NOT EXISTS achievement_definitions_published_idx
  ON achievement_definitions (key) WHERE published_at IS NOT NULL AND superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS achievement_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  achievement_key text NOT NULL,
  rule_version text NOT NULL CHECK (char_length(rule_version) BETWEEN 1 AND 64),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, achievement_key)
);
CREATE INDEX IF NOT EXISTS achievement_awards_account_idx
  ON achievement_awards (account_id, awarded_at DESC);

-- Seed the version-1 achievements. Idempotent; do not mutate on re-run.
INSERT INTO achievement_definitions (key, rule_version, title, description, condition, reward_xp, published_at)
VALUES
  (
    'first_steps', '2026-08', 'First Steps',
    'Complete your first validated activity.',
    '{"kind": "completed_activities", "min": 1}'::jsonb, 25, now()
  ),
  (
    'three_day_rhythm', '2026-08', 'Three-Day Rhythm',
    'Move on three active days within a single week.',
    '{"kind": "weekly_active_days", "min": 3}'::jsonb, 50, now()
  ),
  (
    'seven_hour_stride', '2026-08', 'Seven-Hour Stride',
    'Accumulate seven hours of capped validated active minutes.',
    '{"kind": "lifetime_capped_minutes", "min": 420}'::jsonb, 40, now()
  ),
  (
    'level_three', '2026-08', 'Level Three',
    'Reach cosmetic level three.',
    '{"kind": "level", "min": 3}'::jsonb, 30, now()
  )
ON CONFLICT (key, rule_version) DO NOTHING;
