import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'governance-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';

interface Stubs {
  roles?: { role: string }[];
  open?: Record<string, unknown>[];
  completed?: string;
  rules?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
    if (sql.includes('FROM account_export_requests')) return { rows: stubs.open ?? [] };
    if (sql.includes('FROM account_deletion_tombstones'))
      return { rows: [{ count: stubs.completed ?? '0' }] };
    if (sql.includes('FROM rule_versions')) return { rows: stubs.rules ?? [] };
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

describe('GET /v1/staff/privacy/requests', () => {
  const queue = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: '/v1/staff/privacy/requests', headers: auth });

  it('shows open requests with how long they have been waiting', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'privacy_officer' }],
      open: [
        {
          account_id: RAVI,
          kind: 'deletion',
          requested_at: new Date(Date.now() - 3 * 3_600_000),
          expires_at: null
        }
      ],
      completed: '12'
    });
    const response = await queue(db);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.completedDeletions).toBe(12);
    expect(body.data[0]).toMatchObject({ accountId: RAVI, kind: 'deletion', openForHours: 3 });
  });

  it('reads the erasure count without naming anybody erased', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], completed: '5' });
    const response = await queue(db);

    // A list of who was erased would rebuild the thing erasure removed.
    expect(response.json().completedDeletions).toBe(5);
    const count = db.calls.find((call) => call.sql.includes('account_deletion_tombstones'))!;
    expect(count.sql).toContain('count(*)');
    expect(count.sql).not.toContain('account_id,');
  });

  it('never reads an email address or a display name', async () => {
    const db = fakeDatabase({ roles: [{ role: 'privacy_officer' }] });
    await queue(db);

    const sql = db.sql();
    expect(sql).not.toContain('email');
    expect(sql).not.toContain('display_name');
    expect(sql).not.toContain('profiles');
  });

  it('offers no way to erase an account from here', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await queue(db);

    // The worker performs erasure; a second path would have none of its
    // ordering guarantees.
    expect(db.sql()).not.toContain('DELETE FROM accounts');
    expect(db.sql()).not.toContain('UPDATE accounts SET');
  });

  it('audits the read and refuses a role that is not the privacy officer', async () => {
    const audited = fakeDatabase({ roles: [{ role: 'privacy_officer' }] });
    await queue(audited);
    expect(audited.calls.find((call) => call.sql.includes('staff_audit_events'))?.values?.[1]).toBe(
      'privacy.queue.read'
    );

    const refused = fakeDatabase({ roles: [{ role: 'moderator' }] });
    expect((await queue(refused)).statusCode).toBe(403);
    expect(refused.sql()).not.toContain('FROM account_export_requests');
  });
});

describe('GET /v1/staff/rules', () => {
  const rules = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: '/v1/staff/rules', headers: auth });

  it('says which version of each kind is live', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'data_steward' }],
      rules: [
        {
          kind: 'progression',
          version: 2,
          definition: { dailyCapMinutes: 240 },
          effective_at: new Date('2026-09-01T00:00:00.000Z'),
          superseded_at: null
        },
        {
          kind: 'progression',
          version: 1,
          definition: { dailyCapMinutes: 200 },
          effective_at: new Date('2026-01-01T00:00:00.000Z'),
          superseded_at: new Date('2026-09-01T00:00:00.000Z')
        }
      ]
    });
    const response = await rules(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((rule: { live: boolean }) => rule.live)).toEqual([true, false]);
    expect(response.json().data[0].definition).toEqual({ dailyCapMinutes: 240 });
  });

  it('offers no way to change a rule from here', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await rules(db);

    // Rules are published by migration; editing here would change gameplay
    // without a reviewed change behind it.
    expect(db.sql()).not.toContain('INSERT INTO rule_versions');
    expect(db.sql()).not.toContain('UPDATE rule_versions');
  });

  it('refuses a role that is not the data steward', async () => {
    const db = fakeDatabase({ roles: [{ role: 'campaign_manager' }] });

    expect((await rules(db)).statusCode).toBe(403);
    expect(db.sql()).not.toContain('FROM rule_versions');
  });
});
