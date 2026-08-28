-- Consolidate the privacy/account foundations without rewriting already-applied migrations.
-- Consent remains append-only to normal callers while referential cascades can complete account erasure.
CREATE OR REPLACE FUNCTION prevent_consent_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR current_setting('runsphere.account_erasure', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'consent_history is append-only';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS consent_history_append_only ON consent_history;
CREATE TRIGGER consent_history_append_only
  BEFORE UPDATE OR DELETE ON consent_history
  FOR EACH ROW EXECUTE FUNCTION prevent_consent_history_mutation();

-- Preserve staff audit rows during staff account deletion without retaining a deleted-account reference.
ALTER TABLE staff_audit_events
  ALTER COLUMN staff_account_id DROP NOT NULL;
ALTER TABLE staff_audit_events
  DROP CONSTRAINT IF EXISTS staff_audit_events_staff_account_id_fkey;
ALTER TABLE staff_audit_events
  ADD CONSTRAINT staff_audit_events_staff_account_id_fkey
  FOREIGN KEY (staff_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_account_active_idx
  ON email_verification_tokens (account_id, expires_at DESC) WHERE consumed_at IS NULL;

-- `account_*_requests` were superseded by the active privacy API schema. Migrate any
-- historical requests before removing the unused duplicate tables.
INSERT INTO account_export_requests (account_id, status, requested_at, expires_at)
SELECT account_id,
  CASE WHEN status = 'expired' THEN 'expired' ELSE 'ready' END,
  requested_at,
  coalesce(expires_at, requested_at + interval '7 days')
FROM data_export_requests;

UPDATE accounts account
SET deletion_requested_at = coalesce(
  account.deletion_requested_at,
  request.requested_at
)
FROM (
  SELECT account_id, min(requested_at) AS requested_at
  FROM account_deletion_requests
  WHERE status IN ('requested', 'processing', 'completed')
  GROUP BY account_id
) request
WHERE account.id = request.account_id;

DROP TABLE IF EXISTS data_export_requests;
DROP TABLE IF EXISTS account_deletion_requests;
