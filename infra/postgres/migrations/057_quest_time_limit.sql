-- A quest can carry a time limit, set by staff (season_operator or admin).
--
-- A quest completes only when one quest run passes every stop, and, when a
-- limit is set, passes them all within that many minutes of the run's first
-- point (`services/api/src/quest-core.ts`). NULL means no limit, which is
-- what every existing quest keeps.
--
-- `published_quest_versions` selects `quest.*`, which Postgres expands when the
-- view is created, so the view is recreated with the same definition to pick
-- up the new column (appended last, which CREATE OR REPLACE VIEW allows).
--
-- Rollback: recreate the view from 008 without the column (DROP VIEW then
-- CREATE VIEW, since a column cannot be removed by CREATE OR REPLACE), then
-- ALTER TABLE quest_versions DROP COLUMN time_limit_minutes.

ALTER TABLE quest_versions
  ADD COLUMN IF NOT EXISTS time_limit_minutes integer
    CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600);

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
