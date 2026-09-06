-- Claim-trading review and map events (Phase 5, milestone 5.6; ADR-0011).

-- Ground that two accounts keep passing back and forth.
--
-- **This table is a question, never a verdict.** The pattern it records is
-- produced by collusion and by two friends who race each other every week, and
-- nothing in the data separates them. Nothing in the product acts on a row here:
-- no standing changes, no account is touched, no claim is reversed. A human
-- reads it and decides, and what they are allowed to decide is a policy question
-- that has not been answered yet.
CREATE TABLE IF NOT EXISTS territory_trade_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The piece of ground, not the claim: the whole point is the pattern across
  -- a lineage of takeovers.
  lineage_id uuid NOT NULL,
  -- Stored in sorted order so one pair is one row however the ground moved.
  account_a uuid REFERENCES accounts(id) ON DELETE SET NULL,
  account_b uuid REFERENCES accounts(id) ON DELETE SET NULL,
  CONSTRAINT territory_trade_flags_pair_is_sorted CHECK (account_a < account_b),
  -- Completed there-and-back exchanges, not merely takeovers.
  exchanges integer NOT NULL CHECK (exchanges >= 1),
  -- Share of that ground's takeovers these two account for.
  pair_share numeric(4, 3) NOT NULL CHECK (pair_share BETWEEN 0 AND 1),
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  CONSTRAINT territory_trade_flags_span CHECK (last_at >= first_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 500),
  -- One open row per pair per piece of ground; a re-check updates it.
  UNIQUE (lineage_id, account_a, account_b)
);

CREATE INDEX IF NOT EXISTS territory_trade_flags_open_idx
  ON territory_trade_flags (last_at DESC)
  WHERE reviewed_at IS NULL;

-- Map events: a bounded area and a window, inside which territory counts for
-- something (`product.md` events, spec section 18).
--
-- Deliberately not folded into `competitions`: a competition scores capped
-- active minutes over a period and has no geography, and giving it a nullable
-- boundary would put two scoring models in one table where every read would
-- have to ask which kind it was looking at.
CREATE TABLE IF NOT EXISTS territory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- Said to participants before they run. What counts, and what it is for.
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CONSTRAINT territory_events_window CHECK (ends_at > starts_at),
  -- The area it covers. A claim counts when its centroid falls inside.
  boundary geometry(Polygon, 4326) NOT NULL,
  -- Cosmetic status only, like every other reward in this product
  -- (`product.md`): no cash, no physical prizes, no paid advantage.
  reward text NOT NULL CHECK (char_length(reward) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'announced'
    CHECK (status IN ('announced', 'live', 'ended', 'cancelled')),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_events_live_idx
  ON territory_events USING gist (boundary)
  WHERE status IN ('announced', 'live');

CREATE INDEX IF NOT EXISTS territory_events_window_idx
  ON territory_events (starts_at, ends_at);
