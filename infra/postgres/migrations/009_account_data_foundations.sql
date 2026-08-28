-- Foundation records for account governance, raw-trace custody, validation provenance, and privacy requests.
-- This migration intentionally does not introduce gameplay, safety-contact, quest, goal, or season tables.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_status text NOT NULL DEFAULT 'private_pilot'
    CHECK (email_verification_status IN ('private_pilot', 'verified'));
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_email_verification_state_check,
  DROP CONSTRAINT IF EXISTS accounts_unverified_private_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_email_verification_state_check
  CHECK (
    (email_verification_status = 'verified' AND email_verified_at IS NOT NULL)
    OR (email_verification_status = 'private_pilot' AND email_verified_at IS NULL)
  ),
  ADD CONSTRAINT accounts_unverified_private_check
  CHECK (email_verification_status = 'verified' OR profile_visibility = 'private');

-- Consent records are historical evidence. Corrections are represented by a later row, never a mutation.
DROP TRIGGER IF EXISTS consent_history_append_only ON consent_history;
CREATE OR REPLACE FUNCTION prevent_consent_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consent_history is append-only';
END;
$$;
CREATE TRIGGER consent_history_append_only
  BEFORE UPDATE OR DELETE ON consent_history
  FOR EACH ROW EXECUTE FUNCTION prevent_consent_history_mutation();

-- A reference describes custody of raw trace bytes without exposing those bytes to ordinary queries.
CREATE TABLE IF NOT EXISTS raw_trace_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL UNIQUE REFERENCES activity_submissions(id) ON DELETE CASCADE,
  storage_provider text NOT NULL CHECK (storage_provider IN ('postgres-chunks', 'object-storage')),
  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 512),
  encryption_key_reference text,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  retention_class text NOT NULL CHECK (retention_class IN ('pilot-30-day')),
  retention_until timestamptz NOT NULL,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purged_at IS NULL) OR (purged_at >= created_at))
);
CREATE INDEX IF NOT EXISTS raw_trace_objects_retention_idx
  ON raw_trace_objects (retention_until) WHERE purged_at IS NULL;

CREATE OR REPLACE FUNCTION create_raw_trace_object_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'validating' AND OLD.status = 'received' AND NEW.source_checksum IS NOT NULL THEN
    INSERT INTO raw_trace_objects (
      activity_id, storage_provider, object_key, content_sha256, retention_class, retention_until
    ) VALUES (
      NEW.id, 'postgres-chunks', 'activity/' || NEW.id::text || '/chunks', NEW.source_checksum,
      'pilot-30-day', NEW.raw_trace_retention_until
    ) ON CONFLICT (activity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS activity_submission_raw_trace_reference ON activity_submissions;
CREATE TRIGGER activity_submission_raw_trace_reference
  AFTER UPDATE OF status, source_checksum ON activity_submissions
  FOR EACH ROW EXECUTE FUNCTION create_raw_trace_object_reference();

-- Each attempt is retained so accepted summaries can be traced to the validation rules in effect.
CREATE TABLE IF NOT EXISTS activity_validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  validation_policy_version text NOT NULL,
  validation_algorithm_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'partial')),
  accepted_segment_count integer NOT NULL CHECK (accepted_segment_count >= 0),
  excluded_pause_seconds integer NOT NULL DEFAULT 0 CHECK (excluded_pause_seconds >= 0),
  excluded_gap_seconds integer NOT NULL DEFAULT 0 CHECK (excluded_gap_seconds >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_validation_runs_activity_created_idx
  ON activity_validation_runs (activity_id, created_at DESC);

-- Audit events intentionally store actor/action metadata and a bounded, non-coordinate detail object.
CREATE TABLE IF NOT EXISTS account_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 80),
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_audit_events_account_created_idx
  ON account_audit_events (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'expired', 'cancelled', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  artifact_key text,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS data_export_requests_account_requested_idx
  ON data_export_requests (account_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'cancelled', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reason text,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS account_deletion_requests_account_requested_idx
  ON account_deletion_requests (account_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_active_account_idx
  ON account_deletion_requests (account_id)
  WHERE status IN ('requested', 'processing');
