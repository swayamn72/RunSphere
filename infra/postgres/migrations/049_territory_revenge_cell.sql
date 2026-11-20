-- Keep one cell from each successful carve so the runner who lost it can
-- find the spot on Turf. Older takeovers can still point to the rival claim.
--
-- Nullable and additive: rows written before this migration keep NULL, and
-- the API falls back to the rival claim pin. Rollback: the column is unused
-- by older builds, so leave it, or ALTER TABLE territory_claim_takeovers
-- DROP COLUMN IF EXISTS revenge_cell once no build reads it.
ALTER TABLE territory_claim_takeovers ADD COLUMN IF NOT EXISTS revenge_cell text;
