-- Stop keeping dates of birth once the 18+ check is done (DPDP data minimisation).
--
-- ADR-0014 says a date of birth is "used only for that check", but sign-up
-- stored it in accounts.birth_date for good. The only thing ever read back was
-- whether one had been given (`hasDateOfBirth`), so a boolean replaces it and
-- every stored date is erased. `age_asserted_at` and `age_policy_version`
-- already record when and under which policy the check passed.
--
-- Rollback: the erased dates cannot be restored, by design. An older API build
-- still works against this schema (it would write birth_date again for new
-- sign-ups until this build is redeployed). The flag column is additive; drop it
-- with ALTER TABLE accounts DROP COLUMN IF EXISTS age_checked_by_birth_date once
-- no build reads it.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS age_checked_by_birth_date boolean NOT NULL DEFAULT false;

UPDATE accounts
  SET age_checked_by_birth_date = true, birth_date = NULL
  WHERE birth_date IS NOT NULL;
