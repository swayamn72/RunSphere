-- Run verification: who was present when a run started.
--
-- `run-integrity.ts` already asks whether a trace is physically possible. It
-- cannot ask the other question a prize-bearing leaderboard raises — whether
-- the account holder was the one running — because a friend holding somebody
-- else's phone produces a perfectly ordinary trace. This stores the device's
-- answer to that second question.
--
-- **No biometric data is stored here, and none can be.** The device operating
-- system keeps the face, fingerprint, and passcode inside secure hardware and
-- returns a single boolean to the app. What lands in these columns is: which
-- kind of check ran, when it ran, and an opaque per-installation id. Nothing
-- in a row is a biometric template, derivable into one, or reversible to one.
--
-- The honest limit, repeated here because this is where somebody will read it
-- while writing a query that trusts it: a modified client can write
-- `biometric` without ever prompting anybody. RunSphere does not use platform
-- attestation (Play Integrity, DeviceCheck), so these columns are an audit
-- trail and a deterrent, not proof. Nothing automated may sanction on them.

ALTER TABLE activity_submissions
  -- Null for every run recorded before this shipped, and for every run from an
  -- app build too old to prompt. Absent is its own state and is not 'unenrolled':
  -- one means the client never had the feature, the other means the phone had no
  -- screen lock, and a review queue needs to tell those apart.
  ADD COLUMN IF NOT EXISTS verification_method text
    CHECK (verification_method IN ('biometric', 'device-credential', 'unenrolled', 'unsupported')),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  -- Opaque, client-generated, one per installation. Not a hardware identifier:
  -- it does not survive a reinstall and joins to nothing outside this database.
  -- It exists for exactly one question — whether many accounts verify from a
  -- single phone — which cannot be asked without something stable to group by.
  ADD COLUMN IF NOT EXISTS verification_device_id uuid,
  -- The client's claimed start time, kept only to check the verification against.
  -- A pass stamped an hour before the run does not verify that run, and
  -- `finalized_at`/`created_at` cannot stand in: both are server clocks recording
  -- when the *upload* happened, which on an offline-first client is arbitrarily
  -- later than the run itself.
  ADD COLUMN IF NOT EXISTS client_started_at timestamptz;

-- Both halves of a verification arrive together or not at all. A method with no
-- timestamp cannot be checked for freshness, and a timestamp with no method
-- says nothing, so neither is a state worth representing.
ALTER TABLE activity_submissions
  DROP CONSTRAINT IF EXISTS activity_submissions_verification_complete;
ALTER TABLE activity_submissions
  ADD CONSTRAINT activity_submissions_verification_complete
  CHECK (num_nonnulls(verification_method, verified_at, verification_device_id) IN (0, 3));

-- The grouping this table exists to support: one phone, many accounts. Partial,
-- because the column is null for the entire history preceding this migration and
-- an index over those nulls would be mostly empty.
CREATE INDEX IF NOT EXISTS activity_submissions_verification_device_idx
  ON activity_submissions (verification_device_id, created_at DESC)
  WHERE verification_device_id IS NOT NULL;

COMMENT ON COLUMN activity_submissions.verification_method IS
  'Which device check confirmed the runner at the start of this run. Never contains biometric data.';
COMMENT ON COLUMN activity_submissions.verification_device_id IS
  'Opaque per-installation id, client-generated. Not a hardware identifier and not joinable outside RunSphere.';
