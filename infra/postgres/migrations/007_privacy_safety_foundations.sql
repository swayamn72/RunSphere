-- Privacy, safety, retention, export, deletion, and audit foundations.
-- Privacy zones are always server-normalized 200 m circles around a selected center.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_profile_visibility_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_profile_visibility_check
  CHECK (profile_visibility IN ('private', 'followers'));
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_established_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE privacy_zones
  ADD COLUMN IF NOT EXISTS center geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS radius_meters integer NOT NULL DEFAULT 200
    CHECK (radius_meters = 200);
UPDATE privacy_zones
  SET center = ST_Centroid(geometry)::geometry(Point, 4326)
  WHERE center IS NULL;
UPDATE privacy_zones
  SET geometry = ST_Buffer(center::geography, 200)::geometry
  WHERE GeometryType(geometry) <> 'POLYGON';
ALTER TABLE privacy_zones
  ALTER COLUMN center SET NOT NULL;
ALTER TABLE privacy_zones
  DROP CONSTRAINT IF EXISTS privacy_zones_geometry_type_check;
ALTER TABLE privacy_zones
  ADD CONSTRAINT privacy_zones_geometry_type_check
  CHECK (GeometryType(geometry) = 'POLYGON' AND ST_SRID(geometry) = 4326);
CREATE INDEX IF NOT EXISTS privacy_zones_center_idx ON privacy_zones USING gist (center);

CREATE TABLE IF NOT EXISTS safety_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invitation_sent_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, email)
);
CREATE INDEX IF NOT EXISTS safety_contacts_account_idx ON safety_contacts (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS safety_share_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  safety_contact_id uuid NOT NULL REFERENCES safety_contacts(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES activity_submissions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  delay_minutes integer NOT NULL DEFAULT 15 CHECK (delay_minutes >= 15),
  tile_size_meters integer NOT NULL DEFAULT 500 CHECK (tile_size_meters >= 500),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_share_sessions_active_idx
  ON safety_share_sessions (account_id, expires_at) WHERE status = 'active';

-- Only coarse tile labels are retained for a delayed share; no exact live coordinate or route is stored.
CREATE TABLE IF NOT EXISTS safety_share_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_session_id uuid NOT NULL REFERENCES safety_share_sessions(id) ON DELETE CASCADE,
  tile_x integer NOT NULL,
  tile_y integer NOT NULL,
  observed_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (share_session_id, observed_at)
);
CREATE INDEX IF NOT EXISTS safety_share_updates_available_idx
  ON safety_share_updates (share_session_id, available_at DESC);

CREATE TABLE IF NOT EXISTS account_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX IF NOT EXISTS account_export_requests_account_idx
  ON account_export_requests (account_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS privacy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 100),
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_audit_events_account_idx
  ON privacy_audit_events (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_deletion_tombstones (
  account_id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'user_requested' CHECK (reason = 'user_requested')
);
