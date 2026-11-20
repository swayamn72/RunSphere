-- One territory claim per run (B4).
--
-- `POST /v1/territory/claims` had no check that a run had already been
-- claimed, and the app kept offering the latest run after it was claimed, so
-- one run could be submitted again and again: repeated self-carving, inflated
-- capture counts, duplicate events and notifications.
--
-- Existing databases may already hold such duplicates, which would stop the
-- unique index below from being created. They are kept, because they are real
-- ground people saw on the map, but only the earliest claim from each run
-- keeps its `activity_id`; the later ones are detached (the column is nullable
-- and already `ON DELETE SET NULL`). No claim, boundary, or holder changes.
--
-- Rollback: DROP INDEX territory_claims_one_per_activity. Detached links are
-- not restored; they only ever pointed at a run that had already claimed.

WITH ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY activity_id ORDER BY claimed_at, id) AS position
  FROM territory_claims
  WHERE activity_id IS NOT NULL
)
UPDATE territory_claims claim
SET activity_id = NULL
FROM ranked
WHERE ranked.id = claim.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS territory_claims_one_per_activity
  ON territory_claims (activity_id)
  WHERE activity_id IS NOT NULL;
