-- Clubs and membership (Phase 3, milestone 3.1).
--
-- A club is a private, invite-code-only group. There is no public club list or
-- search (`gameplay.md`), so the code is the entire access path and is
-- generated server-side. Everything club-scoped that follows — member boards,
-- club challenges, relays — is isolated by `club_id` and visible only to
-- active members (`safety-and-privacy.md`), which is why membership is the one
-- authorization boundary these tables define.
--
-- Nothing here stores or references location, route, pace, or activity detail.
-- Relay contributions arrive with their own migration, and even then a club
-- sees aggregates only.

CREATE TABLE IF NOT EXISTS clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Stored already normalized (upper case, no separators) so the join lookup
  -- is an equality match on a unique index rather than a scan.
  invite_code text NOT NULL CHECK (invite_code ~ '^[A-Z0-9]{6,32}$'),
  -- Kept for provenance and moderation. The creator can leave or be removed
  -- later, so this is not the authority record; `club_memberships` is.
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Archiving ends access for everyone while preserving history; a club is
  -- never deleted out from under its audit trail.
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS clubs_invite_code_idx ON clubs (invite_code);

-- Only a live club can be joined by code.
CREATE INDEX IF NOT EXISTS clubs_active_idx ON clubs (id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS club_memberships (
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Left rather than deleted: leaving and being removed are different events,
  -- and a rejoin must not erase that one of them happened.
  left_at timestamptz,
  left_reason text CHECK (left_reason IS NULL OR left_reason IN ('left', 'removed', 'archived')),
  removed_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  PRIMARY KEY (club_id, account_id),
  -- A removal names who did it; a voluntary departure does not.
  CHECK (removed_by_account_id IS NULL OR left_reason = 'removed'),
  CHECK (left_reason IS NULL OR left_at IS NOT NULL)
);

-- Exactly one live owner per club. This is the invariant every authority rule
-- in @runsphere/domain assumes: with no owner, nobody could appoint an admin
-- or archive the club.
CREATE UNIQUE INDEX IF NOT EXISTS club_memberships_single_owner_idx
  ON club_memberships (club_id) WHERE role = 'owner' AND left_at IS NULL;

-- The two hot reads: "which clubs am I in" and "who is in this club".
CREATE INDEX IF NOT EXISTS club_memberships_account_idx
  ON club_memberships (account_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS club_memberships_club_idx
  ON club_memberships (club_id) WHERE left_at IS NULL;
