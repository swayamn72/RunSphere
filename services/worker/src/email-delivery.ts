import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';

/**
 * Email delivery, transactional and campaign (`gameplay.md`, ADR-0010).
 *
 * The mirror of `push-delivery.ts`, and built the same way: a pure decision
 * about whether to send, a provider behind an injected sender, and a record of
 * every outcome in a table so "why did I not get that email" is answerable.
 *
 * **Transactional and campaign email are separated all the way down.** A
 * password reset must reach somebody who has unsubscribed from product news,
 * and a campaign must not reach somebody who has not consented — so they take
 * different paths, check different things, and only share the sender.
 *
 * **Tokens are minted here, at send time, and never stored in plaintext.**
 * Every token table in this schema stores a hash only
 * (`password_reset_tokens.token_hash`, `email_unsubscribe_tokens.token_hash`),
 * which means the API cannot hand a token to an email — it has already thrown
 * the plaintext away by design. So the worker generates the secret when it is
 * about to put it in a message, writes the hash, and keeps the plaintext in
 * memory for the length of one send. Nothing durable ever holds it: not the
 * outbox payload, not a log line, not a delivery record.
 */

export const EMAIL_TRANSACTIONAL_TOPIC = 'email.transactional';

/**
 * What a transactional message is for.
 *
 * **These are the trigger's words, not new ones.** `014` already emits
 * `email.transactional` from triggers on the token and request tables, tagged
 * `password_reset`, `change_verify`, `change_alert_old`, and
 * `deletion_verify`. Renaming them here would mean a migration to rewrite
 * working triggers and a window where queued events matched nothing.
 * `email_verification` is the one this step adds (see `039`).
 */
export type TransactionalKind =
  | 'email_verification'
  | 'password_reset'
  | 'change_verify'
  | 'change_alert_old'
  | 'deletion_verify';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text only. See `renderTransactional` for why there is no HTML. */
  text: string;
  /** Set on campaign sends; a transactional message is not unsubscribable. */
  unsubscribeUrl?: string;
}

/**
 * `suppressed` is distinct from `failed`: the first means this address must
 * never be written to again, the second is transient and retries under the
 * outbox attempt budget.
 */
export type EmailSendResult = 'sent' | 'suppressed' | 'failed';
export type EmailSender = (message: EmailMessage) => Promise<EmailSendResult>;

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface EmailCredentials {
  /** The provider's send endpoint. */
  apiUrl: string;
  apiKey: string;
  /** The envelope sender. Must be a domain the provider has authenticated. */
  from: string;
  /** Where links in transactional email point. */
  appBaseUrl: string;
}

/**
 * Credentials are all or nothing, for the same reason as FCM's: a
 * half-configured provider would fail every event until the attempt budget
 * burned out, permanently marking deliverable mail as failed.
 */
export const readEmailCredentials = (
  environment: NodeJS.ProcessEnv
): EmailCredentials | undefined => {
  const apiUrl = environment.EMAIL_API_URL?.trim();
  const apiKey = environment.EMAIL_API_KEY?.trim();
  const from = environment.EMAIL_FROM?.trim();
  const appBaseUrl = environment.APP_BASE_URL?.trim();
  if (!apiUrl || !apiKey || !from || !appBaseUrl) return undefined;
  return { apiUrl, apiKey, from, appBaseUrl };
};

/**
 * A sender for a provider that takes JSON over HTTPS with a bearer key.
 *
 * That shape covers Resend and Postmark closely and SendGrid approximately,
 * and it needs no dependency. **A different provider is a change to this one
 * function**, which is the whole reason the seam exists: the rest of this file
 * knows nothing about who carries the mail.
 *
 * A 4xx other than 429 is treated as permanent — a malformed address or a
 * blocked recipient will fail identically on every retry, and burning the
 * attempt budget on it delays every other message in the queue.
 */
export const createHttpEmailSender = (
  credentials: EmailCredentials,
  options: { fetchImpl?: FetchLike } = {}
): EmailSender => {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return async (message) => {
    const response = await fetchImpl(credentials.apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: credentials.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        // RFC 8058. A provider that understands it gives mail clients a
        // one-click unsubscribe, which `gameplay.md` requires and which is
        // also what keeps a sending domain out of spam folders.
        ...(message.unsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
              }
            }
          : {})
      })
    });
    if (response.ok) return 'sent';
    if (response.status === 429 || response.status >= 500) return 'failed';
    return 'suppressed';
  };
};

/** An address nobody may write to again. */
export const isSuppressed = async (db: Database, email: string): Promise<boolean> => {
  const found = await db.query<{ email: string }>(
    `SELECT email FROM email_suppressions
     WHERE lower(email) = lower($1) AND unsuppressed_at IS NULL`,
    [email]
  );
  return Boolean(found.rows[0]);
};

export const suppress = async (
  db: Database,
  email: string,
  reason: 'bounce' | 'complaint' | 'manual'
): Promise<void> => {
  await db.query(
    `INSERT INTO email_suppressions (email, reason) VALUES (lower($1), $2)
     ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason,
       suppressed_at = now(), unsuppressed_at = NULL`,
    [email, reason]
  );
};

const token = (): string => randomBytes(32).toString('base64url');

/**
 * Hashed in Node, so the plaintext never leaves this process.
 *
 * The obvious alternative is to let PostgreSQL hash it —
 * `encode(digest($2, 'sha256'), 'hex')` — but that sends the secret itself as a
 * bind parameter, and `infra/compose.yaml` sets
 * `log_min_duration_statement=500`: one slow statement and a live password-reset
 * token is sitting in a database log. Same digest, computed one process
 * earlier, and the wire carries only the hash.
 *
 * Must stay byte-identical to what the API's verification queries compute, or
 * no token would ever validate. Both produce lowercase hex SHA-256 of the UTF-8
 * bytes.
 */
const hashToken = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

/**
 * The unsubscribe link for an account, minting the token if it has none.
 *
 * One stable token per account, so every campaign carries the same link and it
 * keeps working after the campaign is over (`027`). Minted here because the
 * table stores only the hash and nothing else in the product can produce the
 * plaintext.
 */
export const unsubscribeUrlFor = async (
  db: Database,
  accountId: string,
  appBaseUrl: string
): Promise<string | undefined> => {
  const secret = token();
  const stored = await db.query<{ minted: boolean }>(
    `INSERT INTO email_unsubscribe_tokens (account_id, token_hash)
     VALUES ($1, $2)
     ON CONFLICT (account_id) DO NOTHING
     RETURNING true AS minted`,
    [accountId, hashToken(secret)]
  );
  // Already had one, and its plaintext is unrecoverable by design. Rotating it
  // would break links in mail already sent, so this send goes without the
  // one-click header and the in-body link the app renders instead.
  if (!stored.rows[0]) return undefined;
  return `${appBaseUrl.replace(/\/$/, '')}/unsubscribe?token=${secret}`;
};

/**
 * The words each transactional message says.
 *
 * **Plain text, no HTML, no images.** A verification mail that renders remote
 * content is a read receipt for an address the sender has not yet proved
 * belongs to anybody, and an account-security notice is the last place to put
 * a tracking pixel (`safety-and-privacy.md`).
 *
 * Nothing here names a run, a place, a rank, or another account. A transactional
 * message is about the account, and an inbox is not a private space — somebody
 * else may be reading it over a shoulder or on a shared machine.
 */
export const renderTransactional = (
  kind: TransactionalKind,
  context: { appBaseUrl: string; secret?: string; newEmail?: string }
): { subject: string; text: string } => {
  const base = context.appBaseUrl.replace(/\/$/, '');
  const link = (path: string): string => `${base}${path}?token=${context.secret ?? ''}`;
  switch (kind) {
    case 'email_verification':
      return {
        subject: 'Confirm your RunSphere email',
        text: `Confirm this address to finish setting up RunSphere.\n\n${link('/verify-email')}\n\nThe link works for 24 hours. If you did not create a RunSphere account, ignore this message and nothing will happen.`
      };
    case 'password_reset':
      return {
        subject: 'Reset your RunSphere password',
        text: `Use this link to set a new RunSphere password.\n\n${link('/reset-password')}\n\nThe link works for one hour and can be used once. If you did not ask to reset your password, ignore this message — your current password still works.`
      };
    case 'change_verify':
      return {
        subject: 'Confirm your new RunSphere email',
        text: `Confirm this address to finish moving your RunSphere account to it.\n\n${link('/confirm-email-change')}\n\nThe link works for 24 hours. Until you use it, your account keeps its current address.`
      };
    case 'change_alert_old':
      return {
        // Sent to the OLD address, and it carries no link on purpose: its job
        // is to tell somebody their account is being moved, and an urgent
        // message with a link in it is exactly what a phishing attempt looks
        // like. It points at an app they already have.
        subject: 'Your RunSphere email is being changed',
        text: `Somebody asked to move your RunSphere account to ${context.newEmail ?? 'a new address'}.\n\nIf that was you, no action is needed — confirm it from the new address.\n\nIf it was not, open RunSphere and change your password now. The move is not complete until the new address is confirmed.`
      };
    case 'deletion_verify':
      return {
        subject: 'Confirm your RunSphere deletion request',
        text: `Confirm this request to schedule your RunSphere account for deletion.\n\n${link('/confirm-deletion')}\n\nThe link works for 24 hours. Deletion begins after a 30-day waiting period, and signing in to RunSphere cancels it. If you did not ask for this, ignore this message.`
      };
  }
};

/** What one transactional event carries: a kind, and nothing else. */
const parseKind = (payload: unknown): TransactionalKind | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const kind = (payload as Record<string, unknown>).kind;
  const kinds: readonly TransactionalKind[] = [
    'email_verification',
    'password_reset',
    'change_verify',
    'change_alert_old',
    'deletion_verify'
  ];
  return typeof kind === 'string' && kinds.includes(kind as TransactionalKind)
    ? (kind as TransactionalKind)
    : undefined;
};

/** Who to write to, and the secret to put in the link. */
export interface PreparedMessage {
  to: string;
  secret?: string;
  newEmail?: string;
}

/**
 * Rotate the token for one queued message and resolve who it goes to.
 *
 * **Why rotate rather than read.** The API inserts the token row and the
 * trigger fires on it, so by the time this runs the row exists — with only a
 * hash in it. The plaintext was discarded at the API, deliberately and
 * correctly. So the worker writes a *new* hash over the same row and keeps the
 * new plaintext in memory for one send. Nothing durable ever holds a usable
 * token: not the outbox payload, not a log, not a delivery record.
 *
 * Rotating also means the clock starts when the mail goes out rather than when
 * the request was made, which is strictly better for whoever receives it — an
 * hour on a password reset should not be eaten by a backed-up queue.
 *
 * The address is resolved here, in the same statement, rather than carried in
 * the event: an address read now is the current one, and an address copied into
 * a payload minutes ago may have been changed by the very flow that queued it.
 *
 * Returns `undefined` when the row is gone, consumed, expired, or already
 * settled — an event whose reason to exist has passed is not an error.
 */
export const prepareTransactional = async (
  db: Database,
  kind: TransactionalKind,
  /** The outbox aggregate: the id of the token or request row that fired. */
  aggregateId: string
): Promise<PreparedMessage | undefined> => {
  const secret = token();
  const hashed = '$2';

  if (kind === 'password_reset') {
    const rotated = await db.query<{ email: string }>(
      `UPDATE password_reset_tokens reset SET token_hash = ${hashed}
       WHERE reset.id = $1 AND reset.consumed_at IS NULL AND reset.expires_at > now()
       RETURNING (SELECT account.email FROM accounts account
         WHERE account.id = reset.account_id AND account.deleted_at IS NULL) AS email`,
      [aggregateId, hashToken(secret)]
    );
    const email = rotated.rows[0]?.email;
    return email ? { to: email, secret } : undefined;
  }

  if (kind === 'email_verification') {
    const rotated = await db.query<{ email: string }>(
      `UPDATE email_verification_tokens verification SET token_hash = ${hashed}
       WHERE verification.id = $1 AND verification.consumed_at IS NULL
         AND verification.expires_at > now()
       RETURNING (SELECT account.email FROM accounts account
         WHERE account.id = verification.account_id AND account.deleted_at IS NULL) AS email`,
      [aggregateId, hashToken(secret)]
    );
    const email = rotated.rows[0]?.email;
    return email ? { to: email, secret } : undefined;
  }

  if (kind === 'change_verify') {
    // To the NEW address, which is the one being proved.
    const rotated = await db.query<{ new_email: string }>(
      `UPDATE email_change_requests SET token_hash = ${hashed}
       WHERE id = $1 AND status = 'pending' AND expires_at > now()
       RETURNING new_email`,
      [aggregateId, hashToken(secret)]
    );
    const row = rotated.rows[0];
    return row ? { to: row.new_email, secret } : undefined;
  }

  if (kind === 'change_alert_old') {
    // To the OLD address, and no token is minted: this message has no link.
    const found = await db.query<{ old_email: string; new_email: string }>(
      `SELECT old_email, new_email FROM email_change_requests WHERE id = $1`,
      [aggregateId]
    );
    const row = found.rows[0];
    return row ? { to: row.old_email, newEmail: row.new_email } : undefined;
  }

  const rotated = await db.query<{ email: string }>(
    `UPDATE public_deletion_requests SET verification_token_hash = ${hashed}
     WHERE id = $1 AND status = 'requested' AND expires_at > now()
     RETURNING email`,
    [aggregateId, hashToken(secret)]
  );
  const email = rotated.rows[0]?.email;
  return email ? { to: email, secret } : undefined;
};

/**
 * Record what happened, with no address and no body (`039`).
 *
 * Best-effort: a delivery that succeeded must not be retried because the audit
 * insert failed, so this never throws.
 */
const record = async (
  db: Database,
  aggregateId: string,
  kind: TransactionalKind,
  outcome: 'sent' | 'suppressed' | 'rejected' | 'provider_absent' | 'nothing_to_send'
): Promise<void> => {
  try {
    await db.query(
      `INSERT INTO email_dispatches (aggregate_id, kind, outcome) VALUES ($1, $2, $3)`,
      [aggregateId, kind, outcome]
    );
  } catch {
    // Nothing to do about it here, and nothing worth failing a send over.
  }
};

export interface EmailDeliveryDeps {
  db: Database;
  logger: Logger;
  credentials?: EmailCredentials;
  sender?: EmailSender;
}

/**
 * Deliver one transactional event.
 *
 * Never throws for a decision — only for a transient provider failure, which
 * the outbox retries under its attempt budget.
 */
export const deliverTransactional = async (
  { db, logger, credentials, sender }: EmailDeliveryDeps,
  aggregateId: string,
  payload: unknown
): Promise<void> => {
  const kind = parseKind(payload);
  if (!kind) {
    logger.error('email.transactional_malformed', { aggregateId });
    return;
  }
  if (!sender || !credentials) {
    // No provider on this deployment. Logged and dropped rather than retried,
    // so events drain and the queue does not fill with mail nobody can send —
    // the same treatment push gets without FCM credentials.
    await record(db, aggregateId, kind, 'provider_absent');
    logger.info('email.provider_absent', { kind });
    return;
  }

  const prepared = await prepareTransactional(db, kind, aggregateId);
  if (!prepared) {
    // The row is gone, consumed, expired, or already settled. An event whose
    // reason to exist has passed is not a failure.
    await record(db, aggregateId, kind, 'nothing_to_send');
    logger.info('email.nothing_to_send', { kind });
    return;
  }

  // Suppression applies to transactional mail too. An address that hard-bounced
  // does not exist, and writing to it again only damages the sending domain; it
  // cannot silence a security notice for anybody real, because a real address
  // does not hard-bounce.
  if (await isSuppressed(db, prepared.to)) {
    await record(db, aggregateId, kind, 'suppressed');
    logger.info('email.suppressed', { kind });
    return;
  }

  const rendered = renderTransactional(kind, {
    appBaseUrl: credentials.appBaseUrl,
    ...(prepared.secret ? { secret: prepared.secret } : {}),
    ...(prepared.newEmail ? { newEmail: prepared.newEmail } : {})
  });
  const result = await sender({
    to: prepared.to,
    subject: rendered.subject,
    text: rendered.text
  });

  if (result === 'suppressed') {
    await suppress(db, prepared.to, 'bounce');
    await record(db, aggregateId, kind, 'rejected');
    logger.info('email.rejected', { kind });
    return;
  }
  if (result === 'failed') throw new Error(`transactional email failed for ${kind}`);
  await record(db, aggregateId, kind, 'sent');
  // The kind only. An address in a log line is the thing this file exists to
  // be careful with.
  logger.info('email.sent', { kind });
};

/**
 * Deliver one campaign's queued recipients.
 *
 * Every recipient is re-checked at send time, not at queue time: consent can be
 * withdrawn, an address can bounce, and an account can be deleted between the
 * two. `campaigns.ts` resolves the audience when the campaign is scheduled, and
 * this is the second gate that makes that safe.
 */
export const deliverCampaign = async (
  { db, logger, credentials, sender }: EmailDeliveryDeps,
  campaignId: string
): Promise<{ sent: number; skipped: number }> => {
  if (!sender || !credentials) {
    logger.info('email.provider_absent', { campaignId });
    return { sent: 0, skipped: 0 };
  }

  // Joined on the key *and the version recorded when the campaign was
  // scheduled*, which is the whole reason `027` stores that version: a
  // template edited after scheduling must not change what goes out.
  const template = await db.query<{ subject: string; body: string; status: string }>(
    `SELECT template.subject, template.body, campaign.status
     FROM email_campaigns campaign
     JOIN email_templates template ON template.key = campaign.template_key
       AND template.version = campaign.template_version
     WHERE campaign.id = $1`,
    [campaignId]
  );
  const copy = template.rows[0];
  // `paused` is as much a stop as `cancelled`: `gameplay.md` requires an
  // audited pause, and a pause that kept sending would not be one.
  if (!copy || copy.status !== 'sending') {
    logger.info('email.campaign_not_sendable', { campaignId });
    return { sent: 0, skipped: 0 };
  }

  const recipients = await db.query<{ account_id: string; email: string }>(
    `SELECT recipient.account_id, account.email
     FROM email_campaign_recipients recipient
     JOIN accounts account ON account.id = recipient.account_id
     WHERE recipient.campaign_id = $1 AND recipient.status = 'queued'
       AND account.deleted_at IS NULL
     ORDER BY recipient.queued_at
     LIMIT 100`,
    [campaignId]
  );

  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients.rows) {
    const skip = async (reason: string): Promise<void> => {
      await db.query(
        `UPDATE email_campaign_recipients SET status = 'skipped', skip_reason = $3
         WHERE campaign_id = $1 AND account_id = $2`,
        [campaignId, recipient.account_id, reason]
      );
      skipped += 1;
    };

    // Consent, re-read at send time. A campaign is opt-in and revocable, so
    // the answer that matters is the one now and not the one when it was
    // scheduled.
    const consenting = await db.query<{ one: number }>(
      `SELECT 1 AS one FROM notification_preferences
       WHERE account_id = $1 AND marketing_consent = true
         AND coalesce((categories ->> 'marketing')::boolean, false) = true
         AND coalesce((channels ->> 'email')::boolean, false) = true`,
      [recipient.account_id]
    );
    if (!consenting.rows[0]) {
      await skip('consent_withdrawn');
      continue;
    }
    if (await isSuppressed(db, recipient.email)) {
      await skip('suppressed');
      continue;
    }

    const unsubscribeUrl = await unsubscribeUrlFor(
      db,
      recipient.account_id,
      credentials.appBaseUrl
    );
    const result = await sender({
      to: recipient.email,
      subject: copy.subject,
      text: copy.body,
      ...(unsubscribeUrl ? { unsubscribeUrl } : {})
    });

    if (result === 'sent') {
      await db.query(
        `UPDATE email_campaign_recipients SET status = 'sent', sent_at = now()
         WHERE campaign_id = $1 AND account_id = $2`,
        [campaignId, recipient.account_id]
      );
      sent += 1;
      continue;
    }
    if (result === 'suppressed') {
      await suppress(db, recipient.email, 'bounce');
      await skip('rejected');
      continue;
    }
    await db.query(
      `UPDATE email_campaign_recipients SET status = 'failed', last_error = $3
       WHERE campaign_id = $1 AND account_id = $2`,
      [campaignId, recipient.account_id, 'provider unavailable']
    );
  }

  // Finished once nothing is queued. Read rather than inferred from this batch,
  // because a hundred-recipient page may be one of several.
  const remaining = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM email_campaign_recipients
     WHERE campaign_id = $1 AND status = 'queued' LIMIT 1`,
    [campaignId]
  );
  if (!remaining.rows[0]) {
    await db.query(
      `UPDATE email_campaigns SET status = 'sent', completed_at = now()
       WHERE id = $1 AND status = 'sending'`,
      [campaignId]
    );
  }
  logger.info('email.campaign_batch', { campaignId, sent, skipped });
  return { sent, skipped };
};
