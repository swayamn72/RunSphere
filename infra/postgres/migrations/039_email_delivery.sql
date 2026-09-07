-- Email delivery: the missing producer, and a record of what was sent
-- (`gameplay.md` account/notification foundations; ADR-0010).
--
-- `014` wired `email.transactional` triggers onto password resets, email
-- changes, and public deletion requests. **Signup verification was left out**,
-- so `email_verification_tokens` rows have been produced since `010` with
-- nothing to carry them anywhere. Nobody noticed because no provider was
-- configured and the topic drained into a logged no-op.
--
-- This adds that trigger and gives email the same delivery record push has had
-- since `020`, so "why did I not get that mail" is answerable from one table
-- rather than from provider dashboards nobody on call has access to.

CREATE OR REPLACE FUNCTION runsphere_email_outbox() RETURNS trigger AS $$
BEGIN
  INSERT INTO outbox_events (topic, aggregate_id, payload)
  VALUES ('email.transactional', NEW.id, jsonb_build_object('kind', TG_ARGV[0]));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The producer `014` forgot. `email_verification` is the kind name because it
-- is the flow's name everywhere else in the product; the four `014` already
-- established keep theirs, since renaming working triggers would only create a
-- window where queued events matched nothing.
DROP TRIGGER IF EXISTS email_verification_email_trigger ON email_verification_tokens;
CREATE TRIGGER email_verification_email_trigger
  AFTER INSERT ON email_verification_tokens
  FOR EACH ROW EXECUTE FUNCTION runsphere_email_outbox('email_verification');

-- --------------------------------------------------------------------------
-- What was sent, and what happened to it
-- --------------------------------------------------------------------------

-- The counterpart of `push_dispatches` (`020`).
--
-- **No address and no body.** The row records that a message of some kind went
-- out for some aggregate and what the provider said — which is everything an
-- operator needs and nothing a leaked table would hand over. The address is
-- already on the account; the body is reconstructable from the kind.
CREATE TABLE IF NOT EXISTS email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The token or request row the message was about. Not a foreign key: it
  -- points at five different tables depending on the kind, and the record has
  -- to outlive a consumed token either way.
  aggregate_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'email_verification', 'password_reset', 'change_verify',
    'change_alert_old', 'deletion_verify'
  )),
  -- `nothing_to_send` covers a token already consumed or expired by the time
  -- the queue reached it, which is an ordinary outcome and not a failure.
  outcome text NOT NULL CHECK (outcome IN (
    'sent', 'suppressed', 'rejected', 'provider_absent', 'nothing_to_send'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_dispatches_aggregate_idx
  ON email_dispatches (aggregate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_dispatches_recent_idx
  ON email_dispatches (created_at DESC);

-- --------------------------------------------------------------------------
-- Bounces and complaints
-- --------------------------------------------------------------------------

-- `011` created `email_suppressions` and nothing has ever written to it,
-- because nothing was sending. A sender that ignores bounces loses its domain
-- reputation and then loses password resets for everybody, so the webhook that
-- fills this table is part of email working rather than a later refinement.
--
-- The signature secret lives in the environment, not here. What this records is
-- that a provider event was accepted, so a replayed or forged one can be told
-- apart from a real delivery failure during an incident.
CREATE TABLE IF NOT EXISTS email_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The provider's own id for the event, so a redelivery is not counted twice.
  provider_event_id text NOT NULL UNIQUE
    CHECK (char_length(provider_event_id) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (event_type IN ('bounce', 'complaint', 'delivered')),
  -- Hashed, not stored. A suppression list needs the address in the clear to be
  -- checked against, and `email_suppressions` holds it for that reason; this
  -- audit row does not need it, so it does not have it.
  email_hash text NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_provider_events_recent_idx
  ON email_provider_events (received_at DESC);
