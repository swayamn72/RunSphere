-- M2 resumable activity sync, retention metadata, and deletion tombstones.
ALTER TABLE activity_submissions
  DROP CONSTRAINT IF EXISTS activity_submissions_status_check;
ALTER TABLE activity_submissions
  ADD CONSTRAINT activity_submissions_status_check
  CHECK (status IN ('received', 'validating', 'accepted', 'rejected', 'derived', 'deleted'));

ALTER TABLE activity_submissions
  ADD COLUMN IF NOT EXISTS expected_chunk_count integer,
  ADD COLUMN IF NOT EXISTS finalized_checksum text,
  ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_trace_checksum text,
  ADD COLUMN IF NOT EXISTS raw_trace_retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS raw_trace_purged_at timestamptz;
ALTER TABLE activity_submissions
  ADD CONSTRAINT activity_submissions_expected_chunk_count_check
  CHECK (expected_chunk_count IS NULL OR expected_chunk_count BETWEEN 1 AND 10000);
CREATE INDEX IF NOT EXISTS activity_submissions_active_account_created_idx
  ON activity_submissions (account_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE activity_chunks
  ADD COLUMN IF NOT EXISTS encoding text NOT NULL DEFAULT 'identity'
    CHECK (encoding IN ('identity', 'gzip')),
  ADD COLUMN IF NOT EXISTS compressed_bytes integer NOT NULL DEFAULT 0
    CHECK (compressed_bytes BETWEEN 0 AND 1048576),
  ADD COLUMN IF NOT EXISTS uncompressed_bytes integer NOT NULL DEFAULT 0
    CHECK (uncompressed_bytes BETWEEN 0 AND 1048576);

CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_activity_finalized_once_idx
  ON outbox_events (topic, aggregate_id) WHERE topic = 'activity.finalized';
