-- Staff review reads must be attributable without exposing raw GPS or account contact data.
CREATE TABLE IF NOT EXISTS staff_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 80),
  target_count integer NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_audit_events_staff_created_idx
  ON staff_audit_events (staff_account_id, created_at DESC);
