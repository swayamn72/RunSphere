-- Add expiry to the change-email verification token and the public deletion
-- verification token so neither can be redeemed indefinitely. Backfill any
-- existing rows with a 24-hour window before enforcing NOT NULL.
ALTER TABLE email_change_requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE email_change_requests SET expires_at = created_at + interval '24 hours'
  WHERE expires_at IS NULL;
ALTER TABLE email_change_requests ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public_deletion_requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE public_deletion_requests SET expires_at = created_at + interval '24 hours'
  WHERE expires_at IS NULL;
ALTER TABLE public_deletion_requests ALTER COLUMN expires_at SET NOT NULL;
