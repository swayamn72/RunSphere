-- Push delivery registry (ADR-0009). The durable inbox stays the source of
-- truth; a push carries only an opaque notification id and the safe deep link
-- already stored on that inbox row. Titles, bodies, scores, and location never
-- leave the database through this path.
--
-- Two tables, because they answer two different questions: where a push may be
-- sent, and whether one was already dispatched for a notification.

CREATE TABLE IF NOT EXISTS push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Android only. iOS parity is Phase 5; adding 'ios' here without an iOS
  -- client would let a token be stored that nothing can ever deliver to.
  platform text NOT NULL CHECK (platform IN ('android')),
  token text NOT NULL CHECK (char_length(token) BETWEEN 1 AND 4096),
  -- Registration upserts on the hash so the full token is never indexed and a
  -- reinstall that returns the same token cannot accumulate duplicate rows.
  token_hash text NOT NULL CHECK (char_length(token_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Revoked rather than deleted: a provider rejection and a user sign-out are
  -- different events, and the reason is worth keeping for delivery debugging.
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR revoke_reason IN (
    'signed_out', 'replaced', 'provider_unregistered', 'account_closed'
  ))
);

-- A live token belongs to exactly one account: re-registering it elsewhere must
-- move it, never fan a push out to a previous owner of the device.
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_live_token_idx
  ON push_devices (token_hash) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS push_devices_account_idx
  ON push_devices (account_id) WHERE revoked_at IS NULL;

-- One row per notification the worker has already decided about. The primary
-- key is the idempotency guard: an outbox retry after a partial failure finds
-- the row and does not push the same notification twice.
CREATE TABLE IF NOT EXISTS push_dispatches (
  notification_id uuid PRIMARY KEY REFERENCES notification_inbox(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('sent', 'suppressed')),
  -- Why, in the vocabulary of the pure decision function in @runsphere/domain.
  reason text NOT NULL CHECK (reason IN (
    'ok', 'channel_off', 'category_off', 'quiet_hours', 'daily_cap', 'no_devices'
  )),
  device_count integer NOT NULL DEFAULT 0 CHECK (device_count >= 0),
  dispatched_at timestamptz NOT NULL DEFAULT now()
);

-- The per-day frequency cap counts sent dispatches for one account.
CREATE INDEX IF NOT EXISTS push_dispatches_account_sent_idx
  ON push_dispatches (account_id, dispatched_at DESC) WHERE decision = 'sent';
