import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'notification-preferences-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';

const categories = {
  friends: true,
  challenges: true,
  clubs: true,
  competitions: true,
  account: true,
  marketing: false
};

const storedRow = (overrides: Record<string, unknown> = {}) => ({
  categories,
  quiet_hours: null,
  max_per_day: 50,
  channels: { push: true, email: false },
  ...overrides
});

const fakeDatabase = (stored?: Record<string, unknown>) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT categories')) return { rows: stored ? [stored] : [] };
    // The upsert echoes back exactly what it was told to write.
    if (sql.includes('INSERT INTO notification_preferences'))
      return {
        rows: [
          {
            categories: JSON.parse(String(values![1])),
            quiet_hours: values![2] === null ? null : JSON.parse(String(values![2])),
            max_per_day: values![3],
            channels: JSON.parse(String(values![4]))
          }
        ]
      };
    return { rows: [] };
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

const update = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
  appWith(db).inject({
    method: 'PUT',
    url: '/v1/notifications/preferences',
    headers: auth,
    payload
  });

describe('GET /v1/notifications/preferences', () => {
  it('answers usable defaults for an account that never opened settings', async () => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'GET',
      url: '/v1/notifications/preferences',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories,
      maxPerDay: 50,
      channels: { push: true, email: false }
    });
  });
});

describe('PUT /v1/notifications/preferences', () => {
  it('merges a partial update instead of rewriting untouched preferences', async () => {
    const db = fakeDatabase(storedRow({ max_per_day: 12 }));
    const response = await update(db, { channels: { push: false, email: false } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories,
      maxPerDay: 12,
      channels: { push: false, email: false }
    });
  });

  it('stores a quiet-hours window', async () => {
    const db = fakeDatabase(storedRow());
    const response = await update(db, {
      quietHours: { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' }
    });

    expect(response.json().quietHours).toEqual({
      start: '22:00',
      end: '07:00',
      timezone: 'Asia/Kolkata'
    });
  });

  it('clears the window on an explicit null, so quiet hours can be switched off', async () => {
    const db = fakeDatabase(
      storedRow({ quiet_hours: { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' } })
    );
    const response = await update(db, { quietHours: null });

    expect(response.statusCode).toBe(200);
    expect(response.json().quietHours).toBeUndefined();
    const upsert = db.calls.find((call) =>
      call.sql.includes('INSERT INTO notification_preferences')
    )!;
    expect(upsert.values?.[2]).toBeNull();
  });

  it('keeps a stored window when the key is absent', async () => {
    const db = fakeDatabase(
      storedRow({ quiet_hours: { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' } })
    );
    const response = await update(db, { maxPerDay: 20 });

    expect(response.json().quietHours).toEqual({
      start: '22:00',
      end: '07:00',
      timezone: 'Asia/Kolkata'
    });
  });

  it('rejects a cap outside the range the contract allows', async () => {
    const db = fakeDatabase(storedRow());
    expect((await update(db, { maxPerDay: 0 })).statusCode).toBe(400);
    expect((await update(db, { maxPerDay: 201 })).statusCode).toBe(400);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO'))).toBe(false);
  });

  it('rejects a malformed quiet-hours clock rather than storing it', async () => {
    const db = fakeDatabase(storedRow());
    const response = await update(db, {
      quietHours: { start: '25:00', end: '07:00', timezone: 'Asia/Kolkata' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('records the change in the privacy audit trail', async () => {
    const db = fakeDatabase(storedRow());
    await update(db, { maxPerDay: 20 });

    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[1]).toBe('notification_preferences.updated');
  });
});
