-- Store the "hide my start and finish" choice (M9 task 9.0).
--
-- Onboarding has offered a "Trim saved places" switch since M1, but its value
-- never left the phone, so it did nothing. It now lives here, with the other
-- run-visibility settings, and the run log (9.14) applies it on the server:
-- when on, other people see a runner's routes without the first and last 200 m,
-- even where no privacy zone covers them. Default on, for new and existing
-- accounts, because that is what the switch has always claimed to do.
--
-- Rollback: additive. Older builds ignore the column. To undo, ALTER TABLE
-- privacy_settings DROP COLUMN IF EXISTS trim_start_finish once no build reads it.

ALTER TABLE privacy_settings
  ADD COLUMN IF NOT EXISTS trim_start_finish boolean NOT NULL DEFAULT true;
