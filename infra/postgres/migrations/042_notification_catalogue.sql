-- The push notification catalogue: the kinds and the category the last three
-- of `screens.md`'s twelve types need (`notification-catalogue.ts`).
--
-- Five of the twelve already had producers. Seven did not, and three of those
-- had nowhere in the schema to be written at all:
--
--   * `territory_claim` — a carve, a defence, or a ghost race. Separate from
--     `territory_season` because they arrive on completely different rhythms:
--     a carve lands minutes after somebody else's run, a season summary once a
--     month. Same *category*, so one Turf switch still governs both.
--   * `quest` — a quest became available, or one validated.
--   * `streak` — a consistency milestone, with nobody else involved.
--
-- And one new preference category, `progress`, because quests and streaks had
-- no toggle. `screens.md` asks for "per-type on/off preferences"; what exists
-- is the seven-category model from `011`, and the point of the line is that
-- every type is switchable. With `progress` added, all twelve are. Twelve
-- individual switches remain a settings-screen change, not a schema one.

ALTER TABLE notification_inbox DROP CONSTRAINT IF EXISTS notification_inbox_kind_check;
ALTER TABLE notification_inbox ADD CONSTRAINT notification_inbox_kind_check CHECK (kind IN (
  'friend_request', 'challenge_invite', 'challenge_finished',
  'club_invite', 'competition', 'territory_season', 'territory_claim',
  'quest', 'streak', 'account', 'system'
));

-- Existing preference rows predate `progress` and would otherwise read as
-- "progress: off" the moment the key is looked up — which is exactly the bug
-- `territory` had, and the reason `notificationCategoriesFrom` exists. The
-- backfill is still done, because a migrated row needs no merge, and the merge
-- covers the window before this runs.
UPDATE notification_preferences
  SET categories = categories || '{"progress": true}'::jsonb,
      updated_at = now()
  WHERE NOT (categories ? 'progress');

-- --------------------------------------------------------------------------
-- One notice per event
-- --------------------------------------------------------------------------

-- The inbox has no natural key, so every producer so far has guarded against
-- re-delivery by reading back its own `deep_link` first (`territory-rank-job`,
-- `territory-season-reset-job`). That is a race — two workers, or a retried
-- request, both read nothing and both insert — and it gets worse now that a
-- carve notice is written inside the claim transaction, where a retried
-- submission is normal rather than exceptional.
--
-- `dedupe_key` replaces the read-back. Nullable, so nothing existing breaks
-- and a producer with no natural key (a moderation notice, which is a decision
-- and may legitimately repeat) does not have to invent one.
ALTER TABLE notification_inbox
  ADD COLUMN IF NOT EXISTS dedupe_key text
    CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX IF NOT EXISTS notification_inbox_dedupe_idx
  ON notification_inbox (account_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN notification_inbox.dedupe_key IS
  'Producer-chosen natural key for one event, unique per account. Null where an event may legitimately repeat.';
