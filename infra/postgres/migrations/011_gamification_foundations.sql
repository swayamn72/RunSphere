-- Foundation-gate schema for the gamified expansion: profiles/friends/blocks,
-- notification inbox/preferences, versioned periods/rules, analytics events,
-- legal versions, staff RBAC, and account email-lifecycle completion.
-- This migration deliberately does not introduce challenge, club, competition,
-- territory, progression-XP, or campaign tables; those ship with their phases.
-- No raw GPS or per-account H3 traversal is stored by any table here.

-- Public social identity. Accounts remain the auth record; profiles are the
-- only projection ever exposed to gameplay/social surfaces.
CREATE TABLE IF NOT EXISTS profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  cosmetic jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mutual friends require an accepted request. Responding/accepting is app logic.
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  addressee_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_account_id <> addressee_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx
  ON friend_requests (requester_account_id, addressee_account_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friend_requests_addressee_idx
  ON friend_requests (addressee_account_id, created_at DESC) WHERE status = 'pending';

-- Directed friendship rows (both directions inserted on accept) so friend
-- listing is a single index scan and leaving is surgical.
CREATE TABLE IF NOT EXISTS friendships (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  friend_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, friend_account_id),
  CHECK (account_id <> friend_account_id)
);

-- Blocks are symmetric from the blocker's perspective and reversible by the blocker.
CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (blocker_account_id, blocked_account_id),
  CHECK (blocker_account_id <> blocked_account_id)
);

-- Durable in-app inbox of record. deep_link is an opaque, safe deep link.
CREATE TABLE IF NOT EXISTS notification_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'friend_request', 'challenge_invite', 'challenge_finished',
    'club_invite', 'competition', 'account', 'system'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) <= 500),
  deep_link text CHECK (deep_link IS NULL OR char_length(deep_link) <= 500),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_inbox_account_idx
  ON notification_inbox (account_id, created_at DESC);

-- Category preferences, quiet hours, and frequency caps are the single source
-- of truth for both in-app and push delivery.
CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  categories jsonb NOT NULL,
  quiet_hours jsonb,
  max_per_day integer NOT NULL DEFAULT 50 CHECK (max_per_day BETWEEN 1 AND 200),
  channels jsonb NOT NULL DEFAULT '{"push": true, "email": false}'::jsonb,
  marketing_consent boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Canonical weekly period registry. Periods are Monday-based Asia/Kolkata;
-- resets are immutable and never delete history.
CREATE TABLE IF NOT EXISTS weekly_periods (
  period_start date PRIMARY KEY,
  period_end date NOT NULL CHECK (period_end = period_start + 7),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Versioned gameplay rules. A rule change supersedes; it never mutates history.
CREATE TABLE IF NOT EXISTS rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'progression', 'achievement', 'challenge', 'club',
    'competition', 'territory', 'leaderboard', 'notification'
  )),
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  superseded_at timestamptz,
  UNIQUE (kind, version)
);

-- Versioned legal documents. Consent records reference the exact version.
CREATE TABLE IF NOT EXISTS legal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('terms', 'privacy', 'community', 'competition_rules')),
  version integer NOT NULL CHECK (version >= 1),
  effective_at timestamptz NOT NULL,
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 500),
  UNIQUE (kind, version)
);

-- Derived, non-coordinate analytics events. Payload authors must never write
-- latitude, longitude, route geometry, or any coordinate-bearing key.
CREATE TABLE IF NOT EXISTS analytic_events (
  id bigserial PRIMARY KEY,
  event_name text NOT NULL CHECK (char_length(event_name) BETWEEN 1 AND 100),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  feature_version text NOT NULL CHECK (char_length(feature_version) BETWEEN 1 AND 64),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytic_events_name_occurred_idx
  ON analytic_events (event_name, occurred_at DESC);

-- Role-gated staff access replaces the single review-page model.
CREATE TABLE IF NOT EXISTS staff_roles (
  role text PRIMARY KEY CHECK (role IN (
    'admin', 'data_steward', 'moderator', 'privacy_officer',
    'campaign_manager', 'season_operator', 'support'
  ))
);
CREATE TABLE IF NOT EXISTS staff_role_assignments (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL REFERENCES staff_roles(role) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, role)
);

-- Completed account email lifecycle foundations.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_account_active_idx
  ON password_reset_tokens (account_id, expires_at DESC) WHERE consumed_at IS NULL;

-- Change-email verification preserves the old address for the required
-- old-address alert and audit trail.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  old_email text NOT NULL,
  new_email text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CHECK (old_email <> new_email)
);

-- Suppression/bounce handling converges with account deletion and campaign sends.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'manual')),
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  unsuppressed_at timestamptz
);

-- Public (unauthenticated) deletion-request path for Google Play compliance.
-- Completion requires an email-verification token before erasure is scheduled.
CREATE TABLE IF NOT EXISTS public_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  verification_token_hash text UNIQUE CHECK (verification_token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'verified', 'processing', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS public_deletion_requests_email_created_idx
  ON public_deletion_requests (email, created_at DESC);
