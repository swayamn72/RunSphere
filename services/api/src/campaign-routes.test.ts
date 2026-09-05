import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'campaign-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const CAMPAIGN = '00000000-0000-4000-8000-0000000000a1';

const campaignRow = (overrides: Record<string, unknown> = {}) => ({
  id: CAMPAIGN,
  template_key: 'september-news',
  template_version: null,
  audience: { consentRequired: true },
  status: 'draft',
  send_cap: 500,
  scheduled_for: null,
  created_at: new Date('2026-09-01T10:00:00.000Z'),
  queued_count: '0',
  sent_count: '0',
  skipped_count: '0',
  ...overrides
});

interface Stubs {
  roles?: { role: string }[];
  campaigns?: Record<string, unknown>[];
  /** The single-campaign lookup; `[]` means no such campaign. */
  campaign?: Record<string, unknown>[];
  changed?: Record<string, unknown>[];
  templates?: Record<string, unknown>[];
  published?: Record<string, unknown>[];
  template?: { version: number }[];
  matchCount?: string;
  unsubscribeMatch?: { account_id: string }[];
  tokenInserted?: boolean;
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
    if (sql.includes('FROM email_campaigns campaign')) return { rows: stubs.campaigns ?? [] };
    if (sql.includes('INSERT INTO email_campaigns') || sql.includes('UPDATE email_campaigns'))
      return { rows: stubs.changed ?? [campaignRow()] };
    if (sql.includes('FROM email_campaigns WHERE id'))
      return { rows: stubs.campaign ?? [campaignRow()] };
    if (sql.includes('INSERT INTO email_templates'))
      return {
        rows: stubs.published ?? [
          {
            key: 'september-news',
            version: 3,
            subject: 'What is new in September',
            body: 'Hello.',
            created_at: new Date('2026-09-05T10:00:00.000Z')
          }
        ]
      };
    if (sql.includes('SELECT key, version, subject, body, superseded_at'))
      return { rows: stubs.templates ?? [] };
    if (sql.includes('FROM email_templates')) return { rows: stubs.template ?? [{ version: 2 }] };
    if (sql.includes('FROM notification_preferences preference'))
      return { rows: [{ count: stubs.matchCount ?? '42' }] };
    if (sql.includes('UPDATE email_unsubscribe_tokens'))
      return { rows: stubs.unsubscribeMatch ?? [] };
    if (sql.includes('INSERT INTO email_unsubscribe_tokens'))
      return { rows: stubs.tokenInserted === false ? [] : [{ existing: true }] };
    return { rows: [] };
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    return respond(sql);
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    calls,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    sql: () => calls.map((call) => call.sql).join('\n'),
    database(): Database {
      return this as unknown as Database;
    }
  };
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const appWith = (db: ReturnType<typeof fakeDatabase>) => {
  const app = buildApp({ db: db.database(), authSecret: SECRET });
  apps.push(app);
  return app;
};

const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };
const manager = () => fakeDatabase({ roles: [{ role: 'campaign_manager' }] });

describe('POST /v1/staff/campaigns', () => {
  const draft = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({ method: 'POST', url: '/v1/staff/campaigns', headers: auth, payload });

  it('drafts a campaign that sends nothing yet', async () => {
    const db = manager();
    const response = await draft(db, {
      templateKey: 'september-news',
      audience: { consentRequired: true },
      sendCap: 500
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: 'draft', sendCap: 500, queuedCount: 0 });
    // A draft has no schedule and reaches nobody.
    expect(db.sql()).not.toContain('INSERT INTO email_campaign_recipients');
  });

  it('refuses an audience that does not require consent', async () => {
    const db = manager();
    const response = await draft(db, {
      templateKey: 'september-news',
      audience: { consentRequired: false },
      sendCap: 500
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('must require consent');
    // The refused shape never becomes a stored one.
    expect(db.sql()).not.toContain('INSERT INTO email_campaigns');
  });

  it('refuses a narrow recency band, which is behavioural targeting', async () => {
    const db = manager();
    const response = await draft(db, {
      templateKey: 'september-news',
      audience: { consentRequired: true, recencyBandDays: 2 },
      sendCap: 500
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('at least 7 days');
  });

  it('refuses an account without a campaign role', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });
    const response = await draft(db, {
      templateKey: 'september-news',
      audience: { consentRequired: true },
      sendCap: 500
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /v1/staff/campaigns/:campaignId/preview', () => {
  it('answers with counts and never with people', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], matchCount: '1200' });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/staff/campaigns/${CAMPAIGN}/preview`,
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ matchingCount: 1200, cappedCount: 500, sendCap: 500 });
    // The whole response is three integers: the tool cannot become an export
    // of who consented to marketing.
    const body = JSON.stringify(response.json());
    expect(body).not.toContain(ME);
    expect(body).not.toContain('@');
  });

  it('requires all three consent switches, and a verified address', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await appWith(db).inject({
      method: 'GET',
      url: `/v1/staff/campaigns/${CAMPAIGN}/preview`,
      headers: auth
    });

    const count = db.calls.find((call) =>
      call.sql.includes('FROM notification_preferences preference')
    )!;
    expect(count.sql).toContain('preference.marketing_consent = true');
    expect(count.sql).toContain("categories ->> 'marketing'");
    expect(count.sql).toContain("channels ->> 'email'");
    expect(count.sql).toContain('account.email_verified_at IS NOT NULL');
    expect(count.sql).toContain('account.deleted_at IS NULL');
  });

  it('never reads what an activity was, only that one happened', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      campaign: [{ audience: { consentRequired: true, recencyBandDays: 30 }, send_cap: 500 }]
    });
    await appWith(db).inject({
      method: 'GET',
      url: `/v1/staff/campaigns/${CAMPAIGN}/preview`,
      headers: auth
    });

    const count = db.calls.find((call) =>
      call.sql.includes('FROM notification_preferences preference')
    )!;
    for (const forbidden of ['distance', 'active_duration', 'route', 'latitude', 'longitude'])
      expect(count.sql).not.toContain(forbidden);
  });
});

describe('POST /v1/staff/campaigns/:campaignId/schedule', () => {
  const schedule = (db: ReturnType<typeof fakeDatabase>, scheduledFor: string) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/campaigns/${CAMPAIGN}/schedule`,
      headers: auth,
      payload: { scheduledFor }
    });

  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

  it('records the template version so a later edit cannot change the send', async () => {
    const db = manager();
    const response = await schedule(db, inAnHour());

    expect(response.statusCode).toBe(200);
    const update = db.calls.find((call) => call.sql.includes('UPDATE email_campaigns'))!;
    expect(update.values?.[2]).toBe(2);
    expect(update.sql).toContain("status = 'draft'");
  });

  it('refuses a schedule too close to now to be cancelled', async () => {
    const db = manager();
    const response = await schedule(db, new Date(Date.now() + 60_000).toISOString());

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('15 minutes');
    expect(db.sql()).not.toContain('UPDATE email_campaigns');
  });

  it('refuses when no approved template is published', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], template: [] });
    const response = await schedule(db, inAnHour());

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('No approved template');
  });

  it('refuses anything that is not a draft', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      campaign: [campaignRow({ status: 'sent' })]
    });
    const response = await schedule(db, inAnHour());

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /v1/staff/campaigns/:campaignId/cancel', () => {
  const cancel = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/campaigns/${CAMPAIGN}/cancel`,
      headers: auth
    });

  it('cancels a scheduled campaign and drops what was queued', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'campaign_manager' }],
      campaign: [campaignRow({ status: 'scheduled' })],
      changed: [campaignRow({ status: 'cancelled' })]
    });
    const response = await cancel(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('cancelled');
    // Anything still queued is dropped now rather than by a later sweep.
    const dropped = db.calls.find((call) => call.sql.includes('UPDATE email_campaign_recipients'))!;
    expect(dropped.sql).toContain("skip_reason = 'campaign_cancelled'");
  });

  it('refuses to pretend a sent campaign can be recalled', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      campaign: [campaignRow({ status: 'sent' })]
    });
    const response = await cancel(db);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('cannot be recalled');
  });
});

describe('POST /v1/email/unsubscribe', () => {
  const unsubscribe = (db: ReturnType<typeof fakeDatabase>, token = 'a'.repeat(64)) =>
    appWith(db).inject({ method: 'POST', url: '/v1/email/unsubscribe', payload: { token } });

  it('works without signing in', async () => {
    const db = fakeDatabase({ unsubscribeMatch: [{ account_id: RAVI }] });
    const response = await unsubscribe(db);

    expect(response.statusCode).toBe(200);
    // No authorization header was sent at all: an unsubscribe that needs a
    // password is not an unsubscribe.
    expect(db.sql()).toContain('UPDATE notification_preferences');
  });

  it('turns off all three consent switches, not just one', async () => {
    const db = fakeDatabase({ unsubscribeMatch: [{ account_id: RAVI }] });
    await unsubscribe(db);

    const update = db.calls.find((call) => call.sql.includes('UPDATE notification_preferences'))!;
    expect(update.sql).toContain('marketing_consent = false');
    expect(update.sql).toContain("'{marketing}', 'false'::jsonb");
    expect(update.sql).toContain("'{email}', 'false'::jsonb");
  });

  it('records the withdrawal where the consent was recorded', async () => {
    const db = fakeDatabase({ unsubscribeMatch: [{ account_id: RAVI }] });
    await unsubscribe(db);

    const history = db.calls.find((call) => call.sql.includes('INSERT INTO consent_history'))!;
    expect(history.values).toEqual([RAVI]);
    expect(history.sql).toContain("'marketing_email'");
    expect(history.sql).toContain("'unsubscribe_link'");
  });

  it('answers the same way for a token that matched nothing', async () => {
    const matched = fakeDatabase({ unsubscribeMatch: [{ account_id: RAVI }] });
    const unmatched = fakeDatabase({ unsubscribeMatch: [] });
    const first = await unsubscribe(matched);
    const second = await unsubscribe(unmatched, 'b'.repeat(64));

    // An endpoint that said "no such token" would let somebody test tokens.
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());
    expect(unmatched.sql()).not.toContain('UPDATE notification_preferences');
  });

  it('never stores the token itself', async () => {
    const db = fakeDatabase({ unsubscribeMatch: [{ account_id: RAVI }] });
    const token = 'c'.repeat(64);
    await unsubscribe(db, token);

    const lookup = db.calls.find((call) => call.sql.includes('UPDATE email_unsubscribe_tokens'))!;
    expect(lookup.values?.[0]).toBe(createHash('sha256').update(token).digest('hex'));
    expect(lookup.values?.[0]).not.toBe(token);
  });
});

describe('POST /v1/email/unsubscribe-link', () => {
  it('issues a token to the signed-in owner and stores only its hash', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/email/unsubscribe-link',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    const token = response.json().message;
    const insert = db.calls.find((call) =>
      call.sql.includes('INSERT INTO email_unsubscribe_tokens')
    )!;
    expect(insert.values?.[1]).toBe(createHash('sha256').update(token).digest('hex'));
    expect(insert.values).not.toContain(token);
  });

  it('keeps an existing link rather than breaking the one already in inboxes', async () => {
    const db = fakeDatabase({ tokenInserted: false });
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/email/unsubscribe-link',
      headers: auth
    });

    expect(response.json().message).toContain('already exists');
  });

  it('requires a session', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/email/unsubscribe-link',
      headers: { authorization: 'Bearer not-a-real-token' }
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /v1/staff/email-templates', () => {
  const publish = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'POST',
      url: '/v1/staff/email-templates',
      headers: auth,
      payload: {
        key: 'september-news',
        subject: 'What is new in September',
        body: 'Hello.'
      }
    });

  it('publishes a version and makes it the live one', async () => {
    const db = manager();
    const response = await publish(db);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ key: 'september-news', version: 3, live: true });
  });

  it('supersedes the previous version before inserting, inside one transaction', async () => {
    const db = manager();
    await publish(db);

    const statements = db.calls.map((call) => call.sql);
    const supersede = statements.findIndex((sql) => sql.includes('SET superseded_at = now()'));
    const insert = statements.findIndex((sql) => sql.includes('INSERT INTO email_templates'));
    // The partial unique index allows one live version per key, so the old one
    // must be retired first or the insert would violate it.
    expect(supersede).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(supersede);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
  });

  it('never edits an existing version', async () => {
    const db = manager();
    await publish(db);

    // A campaign that already went out under version 1 stays readable as
    // version 1: publishing only ever adds.
    expect(db.sql()).not.toContain('UPDATE email_templates SET subject');
    expect(db.sql()).not.toContain('UPDATE email_templates SET body');
  });

  it('refuses an account without a campaign role', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });

    expect((await publish(db)).statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO email_templates');
  });
});

describe('GET /v1/staff/email-templates', () => {
  it('lists every version and says which is live', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'campaign_manager' }],
      templates: [
        {
          key: 'september-news',
          version: 2,
          subject: 'Now',
          body: 'b',
          superseded_at: null,
          created_at: new Date('2026-09-05T10:00:00.000Z')
        },
        {
          key: 'september-news',
          version: 1,
          subject: 'Before',
          body: 'a',
          superseded_at: new Date('2026-09-05T10:00:00.000Z'),
          created_at: new Date('2026-09-01T10:00:00.000Z')
        }
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/staff/email-templates',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((template: { live: boolean }) => template.live)).toEqual([
      true,
      false
    ]);
  });
});
