-- Consented campaign email (Phase 3, milestone 3.9).
--
-- Marketing email is the one thing RunSphere sends that nobody asked for at
-- the moment it arrives, so every rule here is about consent being real:
-- opt-in only and off by default, an audience built from consent and broad
-- bands rather than from behaviour, a send cap that is part of the record, and
-- an unsubscribe that works from the email itself without signing in.
--
-- `notification_preferences.marketing_consent` has existed since 011 and has
-- never been read or written by anything. It becomes the authoritative
-- consent flag here, alongside the live `categories.marketing` and
-- `channels.email` preferences — a campaign requires all three, so no single
-- forgotten switch can put mail in somebody's inbox.
--
-- Nothing in this schema stores an email address: a recipient is an account
-- id, and the address is read at send time from the account it belongs to.

-- Reviewed, versioned templates. A campaign references a key rather than
-- carrying a body, so what is sent is something a human approved rather than
-- whatever was typed into a scheduling form.
CREATE TABLE IF NOT EXISTS email_templates (
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 80),
  version integer NOT NULL CHECK (version >= 1),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  -- Set when a later version supersedes this one. History is never rewritten:
  -- a campaign that went out under version 1 stays readable as version 1.
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  PRIMARY KEY (key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_live_idx
  ON email_templates (key) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL CHECK (char_length(template_key) BETWEEN 1 AND 80),
  -- The template version resolved when the campaign was scheduled, so a
  -- template edited afterwards cannot change what a scheduled send contains.
  template_version integer CHECK (template_version >= 1),
  -- Consent, locale, app version, feature cohort, and a broad recency band
  -- only. Never location history, pace, health inference, exact quest history,
  -- or free-form SQL (`gameplay.md`).
  audience jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled'
  )),
  -- A hard ceiling on how many accounts one campaign may reach, recorded with
  -- the campaign rather than applied and forgotten.
  send_cap integer NOT NULL CHECK (send_cap BETWEEN 1 AND 100000),
  scheduled_for timestamptz,
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS email_campaigns_due_idx
  ON email_campaigns (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS email_campaigns_listing_idx ON email_campaigns (created_at DESC);

-- Who a campaign reached, and who it deliberately did not. A skipped row is
-- as much a part of the record as a sent one: it is the evidence that consent
-- and the cap were applied rather than assumed.
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason text NOT NULL DEFAULT '' CHECK (char_length(skip_reason) <= 100),
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 500),
  PRIMARY KEY (campaign_id, account_id)
);

CREATE INDEX IF NOT EXISTS email_campaign_recipients_queued_idx
  ON email_campaign_recipients (campaign_id) WHERE status = 'queued';

-- One stable token per account, so every email carries the same unsubscribe
-- link and it keeps working after the campaign is over. Stored hashed: the
-- token is a bearer credential for one narrow act, and a leaked table must not
-- let anybody unsubscribe somebody else.
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
