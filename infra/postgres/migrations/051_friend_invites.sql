-- Friend invite links and QR codes (ADR-0014, SI.3).
--
-- A runner shares one link at a time; whoever opens it while signed in becomes
-- their friend, because sharing it is the consent. Only a SHA-256 of the
-- token is stored, so a database read can't mint working links. Creating a
-- new link revokes the old one; links expire after 7 days.
--
-- Rollback: additive. DROP TABLE IF EXISTS friend_invites once no build reads it.

CREATE TABLE IF NOT EXISTS friend_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS friend_invites_token_hash_unique ON friend_invites (token_hash);
CREATE INDEX IF NOT EXISTS friend_invites_account_idx
  ON friend_invites (account_id, created_at DESC) WHERE revoked_at IS NULL;
