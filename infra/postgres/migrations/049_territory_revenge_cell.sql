-- Keep one cell from each successful carve so the runner who lost it can
-- find the spot on Turf. Older takeovers can still point to the rival claim.
ALTER TABLE territory_claim_takeovers ADD COLUMN IF NOT EXISTS revenge_cell text;
