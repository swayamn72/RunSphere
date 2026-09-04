import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'block-list-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-00000000000c';

const blocked = (accountId: string, displayName: string | null, blockedAt: string) => ({
  id: accountId,
  display_name: displayName,
  cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
  activity_visibility: 'private',
  created_at: new Date(blockedAt)
});

const fakeDatabase = (rows: Record<string, unknown>[] = []) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.includes('FROM blocks block') ? rows : [] };
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    calls,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
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
const list = (db: ReturnType<typeof fakeDatabase>) =>
  appWith(db).inject({ method: 'GET', url: '/v1/blocks', headers: auth });

describe('GET /v1/blocks', () => {
  it('lists the caller live blocks, newest first', async () => {
    const db = fakeDatabase([
      blocked(RAVI, 'Ravi', '2026-09-03T10:00:00.000Z'),
      blocked(ANA, 'Ana', '2026-09-01T10:00:00.000Z')
    ]);
    const response = await list(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          profile: {
            id: RAVI,
            displayName: 'Ravi',
            cosmetic: { avatarKey: 'loop-1' },
            activityVisibility: 'private'
          },
          blockedAt: '2026-09-03T10:00:00.000Z'
        },
        {
          profile: {
            id: ANA,
            displayName: 'Ana',
            cosmetic: { avatarKey: 'loop-1' },
            activityVisibility: 'private'
          },
          blockedAt: '2026-09-01T10:00:00.000Z'
        }
      ]
    });
    const select = db.calls.find((call) => call.sql.includes('FROM blocks block'))!;
    expect(select.sql).toContain('ORDER BY block.created_at DESC');
  });

  it('reads only live blocks the caller created', async () => {
    const db = fakeDatabase();
    await list(db);

    const select = db.calls.find((call) => call.sql.includes('FROM blocks block'))!;
    expect(select.sql).toContain('block.blocker_account_id = $1');
    expect(select.sql).toContain('block.revoked_at IS NULL');
    expect(select.values).toEqual([ME]);
  });

  it('never returns the stored reason or an email address', async () => {
    const db = fakeDatabase([blocked(RAVI, 'Ravi', '2026-09-03T10:00:00.000Z')]);
    const response = await list(db);

    const select = db.calls.find((call) => call.sql.includes('FROM blocks block'))!;
    expect(select.sql).not.toContain('reason');
    expect(select.sql).not.toContain('email');
    expect(response.body).not.toContain('reason');
  });

  it('keeps an account with no display name identifiable enough to unblock', async () => {
    const db = fakeDatabase([blocked(ANA, null, '2026-09-01T10:00:00.000Z')]);
    const response = await list(db);

    expect(response.json().data[0].profile.displayName).toBe('RunSphere member');
    expect(response.json().data[0].profile.cosmetic).toEqual({ avatarKey: 'default' });
  });

  it('answers an empty list rather than an error when nobody is blocked', async () => {
    const response = await list(fakeDatabase());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });

  it('refuses to list without a usable session', async () => {
    const db = fakeDatabase();
    const missing = await appWith(db).inject({ method: 'GET', url: '/v1/blocks' });
    expect(missing.statusCode).toBe(400);

    const invalid = await appWith(db).inject({
      method: 'GET',
      url: '/v1/blocks',
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    expect(invalid.statusCode).toBe(401);
    expect(db.calls.some((call) => call.sql.includes('FROM blocks block'))).toBe(false);
  });
});
