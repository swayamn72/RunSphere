-- Social identity and privacy controls (ADR-0014).
--
-- Adds a unique @username, a date of birth for the 18+ check, an optional
-- home area (a neighbourhood name, never a point) and one privacy_settings
-- row per account that the API enforces on every read.
--
-- Existing accounts get a generated username (runner_ + 12 hex characters of
-- their id, so it is unique and valid) and settings that are no more public
-- than before: profile Friends, not searchable, name hidden on ground. They
-- are asked to review once (`reviewed_at IS NULL`). New sign-ups get the
-- defaults the API writes.
--
-- Rollback: additive. Older builds ignore the new columns and table. To undo,
-- DROP TABLE IF EXISTS privacy_settings, then ALTER TABLE accounts DROP COLUMN
-- IF EXISTS for username, birth_date and home_area, once no build reads them.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS home_area text
    CHECK (home_area IS NULL OR char_length(home_area) BETWEEN 1 AND 60);

UPDATE accounts
  SET username = 'runner_' || substr(replace(id::text, '-', ''), 1, 12)
  WHERE username IS NULL;

-- A random valid name for any insert that doesn't choose one (scripts, tests,
-- staff seeding). Sign-up always sets the runner's own choice.
ALTER TABLE accounts
  ALTER COLUMN username SET DEFAULT 'runner_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
ALTER TABLE accounts ALTER COLUMN username SET NOT NULL;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_username_format_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_username_format_check
  CHECK (username ~ '^[a-z][a-z0-9_]{2,19}$');

CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_unique ON accounts (lower(username));
-- Prefix search on usernames.
CREATE INDEX IF NOT EXISTS accounts_username_prefix_idx
  ON accounts (lower(username) text_pattern_ops);

CREATE TABLE IF NOT EXISTS privacy_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  profile_visibility text NOT NULL DEFAULT 'everyone'
    CHECK (profile_visibility IN ('everyone', 'friends', 'only_me')),
  searchable boolean NOT NULL DEFAULT true,
  friend_requests_from text NOT NULL DEFAULT 'everyone'
    CHECK (friend_requests_from IN ('everyone', 'friends_of_friends', 'nobody')),
  runs_visibility text NOT NULL DEFAULT 'friends'
    CHECK (runs_visibility IN ('everyone', 'friends', 'only_me')),
  show_route_maps boolean NOT NULL DEFAULT true,
  show_start_times boolean NOT NULL DEFAULT false,
  name_on_ground boolean NOT NULL DEFAULT true,
  draw_ground boolean NOT NULL DEFAULT true,
  friend_board boolean NOT NULL DEFAULT true,
  ghost_races boolean NOT NULL DEFAULT true,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Existing accounts: nothing becomes more visible than it was.
INSERT INTO privacy_settings (account_id, profile_visibility, searchable, runs_visibility, name_on_ground)
SELECT account.id, 'friends', false,
  CASE WHEN account.profile_visibility = 'followers' THEN 'friends' ELSE 'only_me' END,
  false
FROM accounts account
ON CONFLICT (account_id) DO NOTHING;

-- Every account gets a profile, named after its username until the runner
-- picks a display name. Without one, list queries that join profiles (friend
-- requests, friends) silently dropped the account: a new runner's friend
-- request was created but never shown to the person they asked.
INSERT INTO profiles (account_id, display_name, cosmetic)
SELECT account.id, account.username, '{"avatarKey":"default"}'::jsonb
FROM accounts account
WHERE NOT EXISTS (SELECT 1 FROM profiles profile WHERE profile.account_id = account.id)
ON CONFLICT (account_id) DO NOTHING;
