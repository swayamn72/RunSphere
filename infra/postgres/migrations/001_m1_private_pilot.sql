-- M1 private-pilot persistence. Apply migrations lexically and record them in schema_migrations.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  age_asserted_at timestamptz NOT NULL,
  age_policy_version text NOT NULL,
  profile_visibility text NOT NULL DEFAULT 'private' CHECK (profile_visibility = 'private'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_email_ci_unique ON accounts (lower(email));

CREATE TABLE consent_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  granted boolean NOT NULL,
  policy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_history_account_recorded_idx ON consent_history (account_id, recorded_at DESC);

CREATE TABLE refresh_token_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);
CREATE INDEX refresh_token_families_account_idx ON refresh_token_families (account_id);

CREATE TABLE privacy_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  geometry geometry(Geometry, 4326) NOT NULL,
  geometry_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX privacy_zones_geometry_idx ON privacy_zones USING gist (geometry);
CREATE INDEX privacy_zones_account_idx ON privacy_zones (account_id);

CREATE TABLE activity_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  movement_type text NOT NULL CHECK (movement_type IN ('walk', 'run', 'hike')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'validating', 'accepted', 'rejected', 'derived')),
  source_checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  processed_at timestamptz,
  rejection_reason text,
  summary jsonb,
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX activity_submissions_account_created_idx ON activity_submissions (account_id, created_at DESC);

CREATE TABLE activity_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, sequence)
);

CREATE TABLE activity_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL UNIQUE REFERENCES activity_submissions(id) ON DELETE CASCADE,
  shareable_route geometry(LineString, 4326),
  source_checksum text NOT NULL,
  route_checksum text,
  policy_version text NOT NULL,
  algorithm_version text NOT NULL,
  applied_zone_ids uuid[] NOT NULL DEFAULT '{}',
  removed_point_count integer NOT NULL DEFAULT 0,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at) WHERE processed_at IS NULL;
