-- Bind each idempotency key to the canonical create request.
ALTER TABLE activity_submissions
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

UPDATE activity_submissions
SET request_fingerprint = encode(digest(jsonb_build_object('movementType', movement_type)::text, 'sha256'), 'hex')
WHERE request_fingerprint IS NULL;

ALTER TABLE activity_submissions
  ALTER COLUMN request_fingerprint SET NOT NULL;
