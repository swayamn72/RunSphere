-- Quest interactions: what the recommender learns from (`ml.md` System 2).
--
-- **`ml.md` says these tables "already exist in `008_product_core_goals_quests.sql`".
-- They do not.** `008` creates `quest_versions` and `quest_version_checkpoints`
-- — a published catalogue — and nothing anywhere assigns a quest to an account
-- or records one as finished. `xp_entries` even has a `quest_completion` source
-- with no writer. So the recommender's stated data source was missing, and this
-- migration creates it.
--
-- **Nothing writes to these tables yet, and that is the honest state.** The
-- quest lifecycle — accepting one, validating a completion — is not built, and
-- building it is not ML work. Until it exists:
--
--   * `GET /v1/quests/recommended` returns a proximity-sorted list and says so
--     in words (`QUEST_PROXIMITY_NOTE`), which is what it must do at zero data
--     regardless.
--   * The weekly training job finds fewer interactions than
--     `QUEST_FLEET_INTERACTION_FLOOR` and proposes nothing.
--
-- These are created now rather than later because the serving path has to read
-- from somewhere, and a query against a table that does not exist cannot be
-- tested at all.

-- Somebody took a quest on. One row per account per quest version: taking the
-- same quest on twice is the same intent, not two.
CREATE TABLE IF NOT EXISTS quest_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quest_version_id uuid NOT NULL REFERENCES quest_versions(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  -- Set when somebody backs out. Kept rather than deleted: "accepted then
  -- abandoned" is a signal, and `ml.md` says the engine "learns from completed,
  -- skipped, and declined runs".
  abandoned_at timestamptz,
  UNIQUE (account_id, quest_version_id)
);

CREATE INDEX IF NOT EXISTS quest_acceptances_account_idx
  ON quest_acceptances (account_id, accepted_at DESC);

-- Somebody finished one. Separate from acceptance because the interaction
-- matrix weights them differently — `ml.md`: "1 = accepted, 2 = completed".
CREATE TABLE IF NOT EXISTS quest_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quest_version_id uuid NOT NULL REFERENCES quest_versions(id) ON DELETE CASCADE,
  -- The run that finished it, so a completion is always traceable to a
  -- validated activity rather than asserted by a client.
  activity_submission_id uuid REFERENCES activity_submissions(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, quest_version_id)
);

CREATE INDEX IF NOT EXISTS quest_completions_account_idx
  ON quest_completions (account_id, completed_at DESC);

-- The training read: every interaction, both kinds, as one matrix. A view
-- rather than a join written out in two languages — `train.py` and the worker
-- both need exactly this, and they must agree on the weights.
CREATE OR REPLACE VIEW quest_interactions AS
SELECT
  acceptance.account_id,
  acceptance.quest_version_id,
  -- 2 when it was finished, 1 when it was only taken on, 0 when abandoned
  -- without finishing. Abandonment is kept as an explicit zero rather than
  -- dropped, so "tried it and stopped" is distinguishable from "never saw it".
  CASE
    WHEN completion.id IS NOT NULL THEN 2
    WHEN acceptance.abandoned_at IS NOT NULL THEN 0
    ELSE 1
  END AS weight,
  greatest(acceptance.accepted_at, coalesce(completion.completed_at, acceptance.accepted_at))
    AS interacted_at
FROM quest_acceptances acceptance
LEFT JOIN quest_completions completion
  ON completion.account_id = acceptance.account_id
  AND completion.quest_version_id = acceptance.quest_version_id;

COMMENT ON VIEW quest_interactions IS
  'User-quest interaction matrix for collaborative filtering. No location data.';

ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_kind_check;
ALTER TABLE rule_versions ADD CONSTRAINT rule_versions_kind_check CHECK (kind IN (
  'progression', 'achievement', 'challenge', 'club', 'club_challenge',
  'competition', 'territory', 'territory_claim', 'leaderboard', 'notification',
  'global_board', 'route_suggestion', 'ghost_race', 'ml_anticheat',
  'quest_recommend'
));

INSERT INTO rule_versions (kind, version, definition, effective_at)
VALUES (
  'quest_recommend',
  1,
  '{"limit": 5, "radiusMetres": 20000, "coldStartInteractions": 3,
    "fleetInteractionFloor": 500, "retrainIntervalDays": 7,
    "factors": 64, "iterations": 20}'::jsonb,
  now()
)
ON CONFLICT (kind, version) DO NOTHING;
