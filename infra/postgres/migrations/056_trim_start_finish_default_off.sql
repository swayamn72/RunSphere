-- "Hide start and finish" is off by default for new accounts (ADR-0015).
--
-- 053 added privacy_settings.trim_start_finish defaulting on. The owner decided
-- on 2026-11-22 that friends see the whole route by default, start and finish
-- included; a runner can still switch the trim on in Privacy settings, and
-- privacy zones still trim whatever falls inside them.
--
-- Only the default changes. Existing rows keep their value: nothing records
-- whether a runner chose "on" or simply got it, and turning it off for someone
-- who chose it would show where they start without asking.
--
-- Rollback: ALTER TABLE privacy_settings ALTER COLUMN trim_start_finish SET DEFAULT true.

ALTER TABLE privacy_settings ALTER COLUMN trim_start_finish SET DEFAULT false;
