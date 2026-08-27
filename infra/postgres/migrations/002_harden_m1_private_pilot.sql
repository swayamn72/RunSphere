-- Harden M1 persistence. Extensions are idempotent for Compose and managed PostGIS deployments.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE activity_derivations
  ALTER COLUMN shareable_route TYPE geometry(MultiLineString, 4326)
  USING CASE
    WHEN shareable_route IS NULL THEN NULL
    ELSE ST_Multi(shareable_route)::geometry(MultiLineString, 4326)
  END;
ALTER TABLE activity_derivations
  ADD COLUMN IF NOT EXISTS applied_zones jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES refresh_token_families(id) ON DELETE CASCADE,
  selector_hash text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;
CREATE INDEX IF NOT EXISTS outbox_events_claim_idx
  ON outbox_events (created_at)
  WHERE processed_at IS NULL AND failed_at IS NULL;
