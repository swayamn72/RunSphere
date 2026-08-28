-- Product-core slice: validated activity outputs, weekly goals, and reviewed curated quests.
-- This migration deliberately extends the feature schema; M1/M2 migrations remain unchanged.
CREATE TABLE activity_validation_outputs (
  activity_id uuid PRIMARY KEY REFERENCES activity_submissions(id) ON DELETE CASCADE,
  active_duration_seconds integer NOT NULL CHECK (active_duration_seconds >= 0),
  distance_meters double precision NOT NULL CHECK (distance_meters >= 0),
  accepted_point_count integer NOT NULL CHECK (accepted_point_count >= 0),
  rejected_point_count integer NOT NULL CHECK (rejected_point_count >= 0),
  rejected_gap_count integer NOT NULL CHECK (rejected_gap_count >= 0),
  validation_algorithm_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_validation_outputs_activity_idx ON activity_validation_outputs (activity_id);

CREATE TABLE weekly_activity_goals (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  active_minutes_goal integer CHECK (active_minutes_goal BETWEEN 1 AND 10080),
  distance_meters_goal integer CHECK (distance_meters_goal BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_minutes_goal IS NOT NULL OR distance_meters_goal IS NOT NULL)
);

CREATE TABLE curated_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE CHECK (char_length(stable_key) BETWEEN 1 AND 160),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  geometry geometry(Geometry, 4326) NOT NULL,
  geometry_version integer NOT NULL DEFAULT 1 CHECK (geometry_version >= 1),
  open_hours jsonb NOT NULL,
  accessibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL,
  retired_at timestamptz
);
CREATE INDEX curated_places_geometry_idx ON curated_places USING gist (geometry);

CREATE TABLE curated_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE CHECK (char_length(stable_key) BETWEEN 1 AND 160),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  checkpoint_kind text NOT NULL CHECK (checkpoint_kind IN ('place', 'route', 'area')),
  place_id uuid REFERENCES curated_places(id),
  geometry geometry(Geometry, 4326) NOT NULL,
  geometry_version integer NOT NULL DEFAULT 1 CHECK (geometry_version >= 1),
  open_hours jsonb NOT NULL,
  accessibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL,
  retired_at timestamptz,
  CHECK ((checkpoint_kind = 'place') = (place_id IS NOT NULL))
);
CREATE INDEX curated_checkpoints_geometry_idx ON curated_checkpoints USING gist (geometry);

CREATE TABLE quest_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_key text NOT NULL CHECK (char_length(quest_key) BETWEEN 1 AND 160),
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  distance_meters integer NOT NULL CHECK (distance_meters > 0),
  estimated_active_minutes integer NOT NULL CHECK (estimated_active_minutes > 0),
  accessibility text NOT NULL CHECK (accessibility IN ('step-free', 'mixed', 'unknown')),
  open_hours jsonb NOT NULL,
  source_reviewed_at timestamptz NOT NULL,
  provenance jsonb NOT NULL,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quest_key, version)
);
CREATE INDEX quest_versions_published_idx ON quest_versions (published_at DESC)
  WHERE published_at IS NOT NULL AND unpublished_at IS NULL;

CREATE TABLE quest_version_checkpoints (
  quest_version_id uuid NOT NULL REFERENCES quest_versions(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES curated_checkpoints(id),
  position integer NOT NULL CHECK (position >= 1),
  PRIMARY KEY (quest_version_id, checkpoint_id),
  UNIQUE (quest_version_id, position)
);

CREATE OR REPLACE VIEW published_quest_versions AS
SELECT quest.*
FROM quest_versions quest
WHERE quest.published_at IS NOT NULL
  AND quest.unpublished_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM quest_version_checkpoints link
    JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
    LEFT JOIN curated_places place ON place.id = checkpoint.place_id
    WHERE link.quest_version_id = quest.id
      AND (checkpoint.retired_at IS NOT NULL OR (checkpoint.place_id IS NOT NULL AND place.retired_at IS NOT NULL))
  );
