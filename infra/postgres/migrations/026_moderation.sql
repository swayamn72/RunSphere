-- Moderation: reports, sanctions, and appeals (Phase 3, milestone 3.7).
--
-- Blocking shipped in 2.9 and is a personal, reversible act: it hides two
-- accounts from each other and asks nothing of anybody. Reporting is the other
-- half — it asks staff to look — and until now it did not exist, so a blocked
-- account could not be reported (`gamification-detailed-plan.md`).
--
-- The shape this schema exists to protect:
--   1. A report is about what somebody published — a display name, a club
--      name, a profile — never about where they were. No report record
--      references an activity, a location, or a route.
--   2. A sanction is told to the account it lands on, in words it can read, and
--      it can be appealed exactly once. A punishment nobody can see or answer
--      is not moderation.
--   3. Every staff decision is attributable and audited.

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- What is being reported. A club is reported for its name or its conduct as
  -- a club; an account for its published identity. There is deliberately no
  -- 'activity' subject: an activity is private to its owner.
  subject_type text NOT NULL CHECK (subject_type IN ('account', 'club')),
  subject_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'impersonation', 'harassment', 'hate_or_violence', 'sexual_content',
    'spam_or_scam', 'self_harm', 'other'
  )),
  -- The reporter's own words. Bounded so the queue stays readable and the
  -- field cannot be used as a data dump.
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Staff-only. No route returns this to a member: the reporter is told their
  -- report was received and nothing more, so a report cannot be used to probe
  -- what happened to somebody else's account.
  resolution_note text NOT NULL DEFAULT '' CHECK (char_length(resolution_note) <= 1000),
  CHECK (reporter_account_id <> subject_id)
);

-- One open report per reporter per subject: a second one adds nothing to the
-- queue and is the obvious way to flood it.
CREATE UNIQUE INDEX IF NOT EXISTS reports_open_unique_idx
  ON reports (reporter_account_id, subject_type, subject_id) WHERE status = 'open';
-- The queue read: oldest open report first, so nothing waits indefinitely.
CREATE INDEX IF NOT EXISTS reports_queue_idx ON reports (created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS reports_subject_idx ON reports (subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- What the sanction actually does, in ascending severity. A warning changes
  -- nothing but the record; a social suspension removes the sharing surfaces
  -- (boards, clubs, challenges) while leaving recording and history intact,
  -- because taking away somebody's own activity data is not a moderation tool.
  kind text NOT NULL CHECK (kind IN ('warning', 'social_suspension', 'account_suspension')),
  reason text NOT NULL CHECK (reason IN (
    'impersonation', 'harassment', 'hate_or_violence', 'sexual_content',
    'spam_or_scam', 'self_harm', 'other'
  )),
  -- Shown to the sanctioned account. A sanction nobody can read is not one.
  statement text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 1000),
  -- NULL means indefinite, which only an account suspension may be.
  expires_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Set when an appeal is upheld or staff lift it early. Never deleted: the
  -- record of what was done, and undone, is the point.
  revoked_at timestamptz,
  revoked_reason text NOT NULL DEFAULT '' CHECK (char_length(revoked_reason) <= 500),
  report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  CHECK (kind <> 'warning' OR expires_at IS NULL)
);

CREATE INDEX IF NOT EXISTS sanctions_account_idx ON sanctions (account_id, issued_at DESC);
-- The enforcement read: live sanctions on one account.
CREATE INDEX IF NOT EXISTS sanctions_live_idx
  ON sanctions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS sanction_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id uuid NOT NULL REFERENCES sanctions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The account's own answer, in its own words.
  statement text NOT NULL CHECK (char_length(statement) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  -- Told to the appellant: a decision without a reason is not an answer.
  decision_note text NOT NULL DEFAULT '' CHECK (char_length(decision_note) <= 1000),
  -- Exactly one appeal per sanction. A second attempt is not a new fact, and
  -- an unlimited appeal is a way to keep staff busy rather than to be heard.
  UNIQUE (sanction_id)
);

CREATE INDEX IF NOT EXISTS sanction_appeals_queue_idx
  ON sanction_appeals (created_at) WHERE status = 'open';
