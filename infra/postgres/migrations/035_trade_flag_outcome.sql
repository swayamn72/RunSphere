-- What a reviewed claim-trading flag concluded (Phase 5, milestone 5.8).
--
-- `033` recorded the question. This records the answer, and it is the first
-- point in this mechanic where a human decision changes anything.
--
-- **The consequence is deliberately the smallest one that works.** An upheld
-- flag removes the ground from leaderboards and nothing else: the claims stay on
-- the map, the accounts are untouched, no history is rewritten, and no run is
-- deleted. Passing ground back and forth is only worth doing because it moves a
-- board position, so removing the board position removes the reason — without
-- punishing two people who may simply race each other every week.
--
-- Reversible by design: dismissing a flag puts the ground straight back.
ALTER TABLE territory_trade_flags
  ADD COLUMN IF NOT EXISTS review_outcome text
    CHECK (review_outcome IS NULL OR review_outcome IN ('upheld', 'dismissed'));

-- An outcome without a reviewer is a verdict nobody signed.
ALTER TABLE territory_trade_flags
  DROP CONSTRAINT IF EXISTS territory_trade_flags_outcome_is_reviewed;
ALTER TABLE territory_trade_flags
  ADD CONSTRAINT territory_trade_flags_outcome_is_reviewed
    CHECK (review_outcome IS NULL OR reviewed_at IS NOT NULL);

-- Boards read this on every request, so the upheld set has its own index.
CREATE INDEX IF NOT EXISTS territory_trade_flags_upheld_idx
  ON territory_trade_flags (lineage_id)
  WHERE review_outcome = 'upheld';
