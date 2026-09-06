-- Failed challenges (Phase 5, milestone 5.7; ADR-0011).
--
-- A territory detail page wants "total battles" and "successful defences", and
-- neither was computable: a challenge that came up short returned a message and
-- left no trace. Only successful takeovers were recorded, so the map could say
-- how often ground changed hands and never how often somebody held it.
--
-- This records the other half. A defence is an attempt that did not beat the
-- holder's time — which means a defence is something the *holder* is credited
-- with without doing anything, and that is correct: they set a time nobody has
-- beaten yet.
CREATE TABLE IF NOT EXISTS territory_claim_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ground, so a page can count battles across every owner it has had.
  lineage_id uuid NOT NULL,
  -- The claim that held the ground at the time. Nulled if it is ever removed;
  -- the attempt still happened.
  defending_claim_id uuid REFERENCES territory_claims(id) ON DELETE SET NULL,
  defending_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  challenger_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Both times, copied in rather than joined out, so the record survives either
  -- account being erased.
  holder_duration_seconds integer NOT NULL CHECK (holder_duration_seconds > 0),
  challenger_duration_seconds integer NOT NULL CHECK (challenger_duration_seconds > 0),
  -- An attempt that was quick enough would have been a takeover, not an
  -- attempt. Enforced so the two tables can never tell contradictory stories.
  CONSTRAINT territory_claim_attempts_did_not_beat
    CHECK (challenger_duration_seconds >= holder_duration_seconds),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS territory_claim_attempts_lineage_idx
  ON territory_claim_attempts (lineage_id, created_at DESC);

CREATE INDEX IF NOT EXISTS territory_claim_attempts_defender_idx
  ON territory_claim_attempts (defending_account_id, created_at DESC);
