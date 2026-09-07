-- Turf monthly seasons: the reset, the snapshots, the hall of fame
-- (territory-guide.md; pending-work 2.5-2.8).
--
-- `036` gave every claim a `season_month`. This gives the month itself a row,
-- so the reset has something to be idempotent against, and gives the season a
-- memory, so a finished month is still readable after the map has cleared.
--
-- Three tables, and the reason each is separate:
--
--   * `territory_claim_seasons` is the season's own state. The reset job is driven by
--     it rather than by a clock: "is there an open season that is not the
--     current month" is a question that answers correctly whether the worker
--     ran at 00:01 on the 1st or came back three days later.
--
--   * `territory_claim_season_snapshots` is a standing frozen at a moment — every
--     Monday, and once at the end. Frozen because a live board recomputed from
--     current claims cannot answer "where did I finish in October": by then the
--     claims are archived and the ground belongs to somebody else.
--
--   * `territory_claim_hall_of_fame` is what survives the season. One row per record
--     per place, overwritten when beaten.
--
-- **A snapshot has one row per place scope, not one row per account.** The plan
-- specifies `(account_id, season_month, total_area_sqm, peak_area_sqm, rank)` —
-- a single rank. That was written before territory went global, and a single
-- rank cannot say what it is a rank *of*: the same runner is #4 in Mumbai, #31
-- in India, and #2,207 worldwide, and all three are things the app shows. So
-- `scope` and `scope_key` join the key.

CREATE TABLE IF NOT EXISTS territory_claim_seasons (
  -- `YYYY-MM` in Asia/Kolkata, matching `territory_claims.season_month`.
  season_month char(7) PRIMARY KEY
    CHECK (season_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the reset job closes it. Null means this season is being played.
  ended_at timestamptz,
  -- When the reset actually completed, which is not the same as when the month
  -- ended: a worker that was down finishes the job late, and the gap is worth
  -- being able to see rather than having to infer from claim timestamps.
  reset_at timestamptz,
  claims_archived integer NOT NULL DEFAULT 0 CHECK (claims_archived >= 0),
  CONSTRAINT territory_claim_seasons_ends_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- A season that is reset is a season that has ended. The reverse is allowed
  -- for the moment between the two writes inside the reset transaction.
  CONSTRAINT territory_claim_seasons_reset_implies_ended
    CHECK (reset_at IS NULL OR ended_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS territory_claim_seasons_open_idx
  ON territory_claim_seasons (season_month)
  WHERE ended_at IS NULL;

-- --------------------------------------------------------------------------
-- Expiring a claim with its month
-- --------------------------------------------------------------------------

-- `031` gave a claim two ways to exist: live, or released to whoever took it,
-- tied together by `territory_claims_release_is_complete`. A season ending is a
-- third: released, with nobody to release it *to*.
--
-- Recorded as its own column rather than by inventing a successor claim to
-- point at, because "the month ended under this ground" and "somebody ran it
-- faster" are different facts and a territory's history has to be able to tell
-- them apart. `territory-guide.md` calls this state `season_expired`.
ALTER TABLE territory_claims
  ADD COLUMN IF NOT EXISTS season_expired_at timestamptz;

ALTER TABLE territory_claims
  DROP CONSTRAINT IF EXISTS territory_claims_release_is_complete;
ALTER TABLE territory_claims
  DROP CONSTRAINT IF EXISTS territory_claims_release_has_a_reason;
ALTER TABLE territory_claims
  ADD CONSTRAINT territory_claims_release_has_a_reason CHECK (
    -- Live.
    (released_at IS NULL AND released_to_claim_id IS NULL AND season_expired_at IS NULL)
    -- Taken by a faster loop.
    OR (released_at IS NOT NULL AND released_to_claim_id IS NOT NULL
        AND season_expired_at IS NULL)
    -- The month ended under it.
    OR (released_at IS NOT NULL AND released_to_claim_id IS NULL
        AND season_expired_at IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS territory_claim_season_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_month char(7) NOT NULL
    CHECK (season_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- `weekly` is a Monday rank inside a running season; `final` is taken once,
  -- immediately before the claims are archived.
  kind text NOT NULL CHECK (kind IN ('weekly', 'final')),
  -- Which board this rank belongs to. `scope_key` is a city name, an ISO
  -- country code, or the literal `GLOBAL`.
  scope text NOT NULL CHECK (scope IN ('city', 'country', 'global')),
  scope_key text NOT NULL CHECK (char_length(scope_key) BETWEEN 1 AND 80),
  -- The Asia/Kolkata Monday a weekly snapshot covers. Null on a final one.
  week_start date,
  CONSTRAINT territory_claim_season_snapshots_week_matches_kind
    CHECK ((kind = 'weekly') = (week_start IS NOT NULL)),
  total_area_sqm double precision NOT NULL CHECK (total_area_sqm >= 0),
  -- The most they held at any snapshot this season. What a season is
  -- remembered by: a final total is a poor summary of a mechanic where ground
  -- changes hands, and rewards being lucky on the 31st.
  peak_area_sqm double precision NOT NULL CHECK (peak_area_sqm >= 0),
  CONSTRAINT territory_claim_season_snapshots_peak_is_peak
    CHECK (peak_area_sqm >= total_area_sqm),
  claim_count integer NOT NULL CHECK (claim_count >= 0),
  rank integer NOT NULL CHECK (rank >= 1),
  -- Days their longest-standing claim had been held. For the recap card.
  longest_held_days integer NOT NULL DEFAULT 0 CHECK (longest_held_days >= 0),
  taken_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotence, split by kind because `week_start` is null on one of them and a
-- null never conflicts with anything in a plain UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS territory_claim_season_snapshots_weekly_key
  ON territory_claim_season_snapshots (account_id, season_month, scope, scope_key, week_start)
  WHERE kind = 'weekly';

CREATE UNIQUE INDEX IF NOT EXISTS territory_claim_season_snapshots_final_key
  ON territory_claim_season_snapshots (account_id, season_month, scope, scope_key)
  WHERE kind = 'final';

-- How every historical board is read: one scope, one season, in rank order.
CREATE INDEX IF NOT EXISTS territory_claim_season_snapshots_board_idx
  ON territory_claim_season_snapshots (season_month, kind, scope, scope_key, rank);

CREATE INDEX IF NOT EXISTS territory_claim_season_snapshots_account_idx
  ON territory_claim_season_snapshots (account_id, season_month DESC);

CREATE TABLE IF NOT EXISTS territory_claim_hall_of_fame (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both records are areas, so both are m². `largest_holding` is the most
  -- ground one person held at once; `largest_claim` is the biggest single loop.
  record_type text NOT NULL CHECK (record_type IN ('largest_holding', 'largest_claim')),
  scope text NOT NULL CHECK (scope IN ('city', 'country', 'global')),
  scope_key text NOT NULL CHECK (char_length(scope_key) BETWEEN 1 AND 80),
  value_sqm double precision NOT NULL CHECK (value_sqm > 0),
  -- Nulled rather than cascaded when the account goes: the record happened.
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Copied in for the same reason, so an erased holder's record still reads as
  -- a sentence instead of as a blank. This is display identity, which the map
  -- and every board already publish (ADR-0011); no other account data is here.
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  season_month char(7) NOT NULL
    CHECK (season_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  achieved_at timestamptz NOT NULL DEFAULT now(),
  -- One standing record per kind per place. Beaten means overwritten; the
  -- previous holder's season snapshot still records what they did.
  UNIQUE (record_type, scope, scope_key)
);

CREATE INDEX IF NOT EXISTS territory_claim_hall_of_fame_scope_idx
  ON territory_claim_hall_of_fame (scope, scope_key, record_type);

-- --------------------------------------------------------------------------
-- Territory notifications
-- --------------------------------------------------------------------------

-- A season that ends without telling anybody is a map that mysteriously
-- cleared. `011` fixed the inbox kinds to a list that has no territory in it,
-- so the list is widened before the reset job can write one.
--
-- Its own kind and its own category, rather than folded into `competition`: a
-- season is not something anybody entered, so an account that wants no
-- competition notices should still hear that the month it held ground in is
-- over. The category is what the preference toggle switches
-- (`notification-delivery.ts`), so this is also the switch to turn it off.
ALTER TABLE notification_inbox DROP CONSTRAINT IF EXISTS notification_inbox_kind_check;
ALTER TABLE notification_inbox ADD CONSTRAINT notification_inbox_kind_check CHECK (kind IN (
  'friend_request', 'challenge_invite', 'challenge_finished',
  'club_invite', 'competition', 'territory_season', 'account', 'system'
));

-- Existing preference rows predate the category and would otherwise read as
-- "territory: off" the moment the key is looked up. Defaulted on, like every
-- other non-marketing category (`defaultNotificationPreferences`).
UPDATE notification_preferences
  SET categories = categories || '{"territory": true}'::jsonb,
      updated_at = now()
  WHERE NOT (categories ? 'territory');

-- --------------------------------------------------------------------------
-- The season being played
-- --------------------------------------------------------------------------

-- Open the current month, so the very first sweep has a season to be in rather
-- than opening one as a side effect of the first claim.
INSERT INTO territory_claim_seasons (season_month, started_at)
VALUES (to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'), now())
ON CONFLICT (season_month) DO NOTHING;

-- Any month that already has claims but no season row is a month that was
-- played before this migration existed, and it is already over.
INSERT INTO territory_claim_seasons (season_month, started_at, ended_at, reset_at)
SELECT DISTINCT claim.season_month, min(claim.claimed_at), now(), now()
FROM territory_claims claim
WHERE claim.season_month < to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')
GROUP BY claim.season_month
ON CONFLICT (season_month) DO NOTHING;
