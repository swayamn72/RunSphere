import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import {
  createHttpEmailSender,
  deliverCampaign,
  deliverTransactional,
  readEmailCredentials,
  renderTransactional,
  type EmailCredentials,
  type EmailMessage,
  type EmailSendResult,
  type FetchLike
} from './email-delivery.js';

/**
 * Email delivery, against a fake database.
 *
 * What is checked here is the part that decides *whether and what to send*:
 * the provider gate, suppression, consent re-read at send time, and the copy.
 * The SQL that rotates tokens is covered by the PostGIS suite, because a
 * rotation that silently matched no row would pass any fake.
 */
const CREDENTIALS: EmailCredentials = {
  apiUrl: 'https://provider.test/send',
  apiKey: 'key',
  from: 'RunSphere <no-reply@runsphere.test>',
  appBaseUrl: 'https://runsphere.test/'
};

const logger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn()
});

interface Stubs {
  suppressed?: Record<string, unknown>[];
  rotated?: Record<string, unknown>[];
  changeRequest?: Record<string, unknown>[];
  campaign?: Record<string, unknown>[];
  recipients?: Record<string, unknown>[];
  consent?: Record<string, unknown>[];
  unsubscribe?: Record<string, unknown>[];
  queuedLeft?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    statements.push({ sql, values });
    if (sql.includes('FROM email_suppressions')) return { rows: stubs.suppressed ?? [] };
    if (sql.includes('SELECT old_email, new_email')) return { rows: stubs.changeRequest ?? [] };
    if (
      sql.includes('UPDATE password_reset_tokens') ||
      sql.includes('UPDATE email_verification_tokens')
    )
      return { rows: stubs.rotated ?? [{ email: 'runner@example.test' }] };
    if (sql.includes('UPDATE email_change_requests'))
      return { rows: stubs.rotated ?? [{ new_email: 'new@example.test' }] };
    if (sql.includes('UPDATE public_deletion_requests'))
      return { rows: stubs.rotated ?? [{ email: 'runner@example.test' }] };
    if (sql.includes('FROM email_campaigns campaign')) return { rows: stubs.campaign ?? [] };
    if (sql.includes('FROM email_campaign_recipients recipient'))
      return { rows: stubs.recipients ?? [] };
    if (sql.includes('FROM notification_preferences')) return { rows: stubs.consent ?? [] };
    if (sql.includes('INSERT INTO email_unsubscribe_tokens'))
      return { rows: stubs.unsubscribe ?? [{ minted: true }] };
    if (sql.includes("status = 'queued' LIMIT 1")) return { rows: stubs.queuedLeft ?? [] };
    return { rows: [] };
  });
  return {
    statements,
    sql: () => statements.map((entry) => entry.sql).join('\n'),
    db: { query, connect: vi.fn(), end: vi.fn() } as unknown as Database
  };
};

const sender = (result: EmailSendResult = 'sent') => {
  const sent: EmailMessage[] = [];
  const send = vi.fn(async (message: EmailMessage) => {
    sent.push(message);
    return result;
  });
  return { sent, send };
};

describe('reading the provider configuration', () => {
  it('needs all four values, or none of it is configured', () => {
    // Half a provider would fail every event until the attempt budget burned
    // out, marking deliverable mail permanently dead.
    expect(readEmailCredentials({})).toBeUndefined();
    expect(
      readEmailCredentials({ EMAIL_API_URL: 'u', EMAIL_API_KEY: 'k', EMAIL_FROM: 'f' })
    ).toBeUndefined();
    expect(
      readEmailCredentials({
        EMAIL_API_URL: 'u',
        EMAIL_API_KEY: 'k',
        EMAIL_FROM: 'f',
        APP_BASE_URL: 'https://a.test'
      })
    ).toEqual({ apiUrl: 'u', apiKey: 'k', from: 'f', appBaseUrl: 'https://a.test' });
  });

  it('treats whitespace as absent', () => {
    expect(
      readEmailCredentials({
        EMAIL_API_URL: '  ',
        EMAIL_API_KEY: 'k',
        EMAIL_FROM: 'f',
        APP_BASE_URL: 'a'
      })
    ).toBeUndefined();
  });
});

describe('the HTTP sender', () => {
  // Typed as the seam it stands in for, so `mock.calls` carries the url and
  // init rather than an empty tuple.
  const respond = (status: number) =>
    vi.fn<FetchLike>(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => ''
    }));

  it('sends and reports success', async () => {
    const fetchImpl = respond(200);
    const send = createHttpEmailSender(CREDENTIALS, { fetchImpl });

    expect(await send({ to: 'a@b.test', subject: 's', text: 't' })).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(CREDENTIALS.apiUrl);
    expect(init.headers.authorization).toBe('Bearer key');
    expect(JSON.parse(init.body)).toMatchObject({ from: CREDENTIALS.from, to: 'a@b.test' });
  });

  it('retries a rate limit and a server fault, and gives up on a bad address', async () => {
    // The distinction that matters: `failed` retries under the outbox budget,
    // `suppressed` never sends to that address again.
    expect(
      await createHttpEmailSender(CREDENTIALS, { fetchImpl: respond(429) })({
        to: 'a@b.test',
        subject: 's',
        text: 't'
      })
    ).toBe('failed');
    expect(
      await createHttpEmailSender(CREDENTIALS, { fetchImpl: respond(503) })({
        to: 'a@b.test',
        subject: 's',
        text: 't'
      })
    ).toBe('failed');
    expect(
      await createHttpEmailSender(CREDENTIALS, { fetchImpl: respond(422) })({
        to: 'a@b.test',
        subject: 's',
        text: 't'
      })
    ).toBe('suppressed');
  });

  it('adds one-click unsubscribe headers only when there is a link', async () => {
    const fetchImpl = respond(200);
    const send = createHttpEmailSender(CREDENTIALS, { fetchImpl });

    await send({ to: 'a@b.test', subject: 's', text: 't' });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).headers).toBeUndefined();

    await send({
      to: 'a@b.test',
      subject: 's',
      text: 't',
      unsubscribeUrl: 'https://runsphere.test/unsubscribe?token=x'
    });
    // RFC 8058, which `gameplay.md` requires and which also keeps a sending
    // domain out of spam folders.
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body).headers).toMatchObject({
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
  });
});

describe('what each message says', () => {
  const render = (kind: Parameters<typeof renderTransactional>[0]) =>
    renderTransactional(kind, {
      appBaseUrl: 'https://runsphere.test/',
      secret: 'tok',
      newEmail: 'new@example.test'
    });

  it('puts the token in a link, with no double slash from a trailing base', () => {
    expect(render('password_reset').text).toContain(
      'https://runsphere.test/reset-password?token=tok'
    );
  });

  it('says what to do when the request was not yours', () => {
    // Every one of these can arrive unprompted, and the person reading it needs
    // to know whether to act.
    for (const kind of ['email_verification', 'password_reset', 'deletion_verify'] as const) {
      expect(render(kind).text).toMatch(/if you did not/i);
    }
  });

  it('gives the old-address alert no link at all', () => {
    const alert = render('change_alert_old');

    // An urgent message with a link in it is what phishing looks like, so this
    // one points at an app they already have.
    expect(alert.text).not.toContain('http');
    expect(alert.text).toContain('new@example.test');
    expect(alert.text).toContain('change your password');
  });

  it('never carries HTML or a remote image', () => {
    // A verification mail that loads remote content is a read receipt for an
    // address nobody has yet proved belongs to anyone.
    for (const kind of [
      'email_verification',
      'password_reset',
      'change_verify',
      'change_alert_old',
      'deletion_verify'
    ] as const) {
      expect(render(kind).text).not.toMatch(/<[a-z]/i);
      expect(render(kind).text).not.toMatch(/<img|src=/i);
    }
  });

  it('says how long a link lasts', () => {
    expect(render('password_reset').text).toContain('one hour');
    expect(render('email_verification').text).toContain('24 hours');
  });
});

describe('delivering a transactional message', () => {
  it('drops the event with a log when no provider is configured', async () => {
    const database = fakeDatabase();
    const log = logger();

    await deliverTransactional({ db: database.db, logger: log }, 'agg-1', {
      kind: 'password_reset'
    });

    // Dropped rather than retried, so the queue does not fill with mail nobody
    // can send — the same treatment push gets without FCM credentials.
    expect(log.info).toHaveBeenCalledWith('email.provider_absent', { kind: 'password_reset' });
    expect(database.sql()).toContain('INSERT INTO email_dispatches');
  });

  it('refuses a payload it cannot read', async () => {
    const database = fakeDatabase();
    const log = logger();

    await deliverTransactional({ db: database.db, logger: log }, 'agg-1', { kind: 'invented' });

    expect(log.error).toHaveBeenCalledWith('email.transactional_malformed', {
      aggregateId: 'agg-1'
    });
  });

  it('rotates the token and sends to the address it resolved', async () => {
    const database = fakeDatabase({ rotated: [{ email: 'runner@example.test' }] });
    const provider = sender();

    await deliverTransactional(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'password_reset' }
    );

    expect(provider.sent[0]!.to).toBe('runner@example.test');
    // The API kept only a hash, so the worker writes a new one and keeps the
    // plaintext for exactly one send.
    expect(database.sql()).toContain('UPDATE password_reset_tokens');
    expect(provider.sent[0]!.text).toMatch(/token=[A-Za-z0-9_-]{20,}/);
  });

  it('never puts the token anywhere durable', async () => {
    const database = fakeDatabase({ rotated: [{ email: 'runner@example.test' }] });
    const provider = sender();
    const log = logger();

    await deliverTransactional(
      { db: database.db, logger: log, credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'password_reset' }
    );

    const secret = /token=([A-Za-z0-9_-]+)/.exec(provider.sent[0]!.text)?.[1];
    expect(secret).toBeDefined();
    // Not in a query parameter, not in a dispatch row, not in a log line.
    for (const entry of database.statements) {
      expect(JSON.stringify(entry.values ?? [])).not.toContain(secret);
    }
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(secret);
    // A 64-character lowercase hex digest is what went to the database, and it
    // is computed in this process precisely so the secret never reaches a
    // statement PostgreSQL might log.
    const bound = database.statements
      .flatMap((entry) => [...(entry.values ?? [])])
      .filter((value): value is string => typeof value === 'string');
    expect(bound.some((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  });

  it('says nothing to send when the row is already consumed or expired', async () => {
    const database = fakeDatabase({ rotated: [] });
    const provider = sender();
    const log = logger();

    await deliverTransactional(
      { db: database.db, logger: log, credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'password_reset' }
    );

    // An event whose reason to exist has passed is not a failure.
    expect(provider.send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('email.nothing_to_send', { kind: 'password_reset' });
  });

  it('will not write to a suppressed address', async () => {
    const database = fakeDatabase({
      rotated: [{ email: 'dead@example.test' }],
      suppressed: [{ email: 'dead@example.test' }]
    });
    const provider = sender();

    await deliverTransactional(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'password_reset' }
    );

    expect(provider.send).not.toHaveBeenCalled();
  });

  it('suppresses an address the provider rejected', async () => {
    const database = fakeDatabase({ rotated: [{ email: 'bad@example.test' }] });
    const provider = sender('suppressed');

    await deliverTransactional(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'password_reset' }
    );

    expect(database.sql()).toContain('INSERT INTO email_suppressions');
  });

  it('throws on a transient failure so the outbox retries it', async () => {
    const database = fakeDatabase({ rotated: [{ email: 'runner@example.test' }] });
    const provider = sender('failed');

    await expect(
      deliverTransactional(
        { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
        'agg-1',
        { kind: 'password_reset' }
      )
    ).rejects.toThrow(/password_reset/);
  });

  it('sends the old-address alert to the old address', async () => {
    const database = fakeDatabase({
      changeRequest: [{ old_email: 'old@example.test', new_email: 'new@example.test' }]
    });
    const provider = sender();

    await deliverTransactional(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'agg-1',
      { kind: 'change_alert_old' }
    );

    expect(provider.sent[0]!.to).toBe('old@example.test');
    // No token is minted for a message with no link in it.
    expect(database.sql()).not.toContain('UPDATE email_change_requests');
  });

  it('logs the kind and never the address', async () => {
    const database = fakeDatabase({ rotated: [{ email: 'runner@example.test' }] });
    const log = logger();

    await deliverTransactional(
      { db: database.db, logger: log, credentials: CREDENTIALS, sender: sender().send },
      'agg-1',
      { kind: 'password_reset' }
    );

    expect(JSON.stringify(log.info.mock.calls)).not.toContain('runner@example.test');
  });
});

describe('delivering a campaign', () => {
  const campaign = (status = 'sending') => [
    { subject: 'News', body: 'Words about running.', status }
  ];

  it('does nothing without a provider', async () => {
    const database = fakeDatabase();

    expect(await deliverCampaign({ db: database.db, logger: logger() }, 'camp-1')).toEqual({
      sent: 0,
      skipped: 0
    });
  });

  it('joins the template version the campaign was scheduled with', async () => {
    const database = fakeDatabase({ campaign: campaign() });

    await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: sender().send },
      'camp-1'
    );

    // `027` records the resolved version so editing a template afterwards
    // cannot change what a scheduled send contains.
    expect(database.sql()).toContain('template.version = campaign.template_version');
  });

  it('will not send a paused or cancelled campaign', async () => {
    for (const status of ['paused', 'cancelled', 'draft']) {
      const database = fakeDatabase({ campaign: campaign(status) });
      const provider = sender();

      await deliverCampaign(
        { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
        'camp-1'
      );

      expect(provider.send).not.toHaveBeenCalled();
    }
  });

  it('re-reads consent at send time and skips somebody who withdrew it', async () => {
    const database = fakeDatabase({
      campaign: campaign(),
      recipients: [{ account_id: 'acc-1', email: 'runner@example.test' }],
      consent: []
    });
    const provider = sender();

    const outcome = await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'camp-1'
    );

    // The audience was resolved when the campaign was scheduled; this is the
    // gate that makes that safe.
    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(1);
    expect(JSON.stringify(database.statements.map((entry) => entry.values))).toContain(
      'consent_withdrawn'
    );
  });

  it('sends to a consenting recipient with an unsubscribe link', async () => {
    const database = fakeDatabase({
      campaign: campaign(),
      recipients: [{ account_id: 'acc-1', email: 'runner@example.test' }],
      consent: [{ one: 1 }]
    });
    const provider = sender();

    const outcome = await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'camp-1'
    );

    expect(outcome.sent).toBe(1);
    expect(provider.sent[0]!.unsubscribeUrl).toContain('/unsubscribe?token=');
    expect(database.sql()).toContain("status = 'sent'");
  });

  it('skips a suppressed recipient without asking the provider', async () => {
    const database = fakeDatabase({
      campaign: campaign(),
      recipients: [{ account_id: 'acc-1', email: 'dead@example.test' }],
      consent: [{ one: 1 }],
      suppressed: [{ email: 'dead@example.test' }]
    });
    const provider = sender();

    await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: provider.send },
      'camp-1'
    );

    expect(provider.send).not.toHaveBeenCalled();
    expect(JSON.stringify(database.statements.map((entry) => entry.values))).toContain(
      'suppressed'
    );
  });

  it('marks the campaign sent once nothing is queued', async () => {
    const database = fakeDatabase({
      campaign: campaign(),
      recipients: [{ account_id: 'acc-1', email: 'runner@example.test' }],
      consent: [{ one: 1 }],
      queuedLeft: []
    });

    await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: sender().send },
      'camp-1'
    );

    expect(database.sql()).toContain("UPDATE email_campaigns SET status = 'sent'");
  });

  it('leaves the campaign sending while recipients remain', async () => {
    const database = fakeDatabase({
      campaign: campaign(),
      recipients: [{ account_id: 'acc-1', email: 'runner@example.test' }],
      consent: [{ one: 1 }],
      queuedLeft: [{ one: 1 }]
    });

    await deliverCampaign(
      { db: database.db, logger: logger(), credentials: CREDENTIALS, sender: sender().send },
      'camp-1'
    );

    expect(database.sql()).not.toContain("UPDATE email_campaigns SET status = 'sent'");
  });
});
