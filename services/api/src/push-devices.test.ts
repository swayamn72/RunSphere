import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'push-device-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const DEVICE = '00000000-0000-4000-8000-0000000000d1';

const registration = {
  id: DEVICE,
  platform: 'android',
  created_at: new Date('2026-09-04T09:00:00.000Z'),
  last_seen_at: new Date('2026-09-04T09:00:00.000Z')
};

interface Stubs {
  registered?: Record<string, unknown>[];
  revoked?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('INSERT INTO push_devices'))
      return { rows: stubs.registered ?? [registration] };
    if (sql.includes('UPDATE push_devices')) return { rows: stubs.revoked ?? [{ id: DEVICE }] };
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

const register = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
  appWith(db).inject({
    method: 'POST',
    url: '/v1/notifications/devices',
    headers: auth,
    payload
  });

describe('POST /v1/notifications/devices', () => {
  it('registers an Android token and answers with the registration, never the token', async () => {
    const db = fakeDatabase();
    const response = await register(db, { token: 'fcm-token-value', platform: 'android' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: DEVICE,
      platform: 'android',
      createdAt: '2026-09-04T09:00:00.000Z',
      lastSeenAt: '2026-09-04T09:00:00.000Z'
    });
    expect(response.body).not.toContain('fcm-token-value');
  });

  it('hashes the token in the database rather than indexing it in the clear', async () => {
    const db = fakeDatabase();
    await register(db, { token: 'fcm-token-value', platform: 'android' });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO push_devices'))!;
    expect(insert.sql).toContain("encode(digest($3, 'sha256'), 'hex')");
    expect(insert.values).toEqual([ME, 'android', 'fcm-token-value']);
  });

  it('moves a token that reappears on another account instead of duplicating it', async () => {
    const db = fakeDatabase();
    await register(db, { token: 'fcm-token-value', platform: 'android' });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO push_devices'))!;
    expect(insert.sql).toContain('ON CONFLICT (token_hash) WHERE revoked_at IS NULL DO UPDATE');
    expect(insert.sql).toContain('account_id = EXCLUDED.account_id');
    expect(insert.sql).toContain('last_seen_at = now()');
  });

  it('records the registration in the privacy audit trail', async () => {
    const db = fakeDatabase();
    await register(db, { token: 'fcm-token-value', platform: 'android' });

    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[1]).toBe('push_device.registered');
    expect(JSON.stringify(audit.values)).not.toContain('fcm-token-value');
  });

  it('rejects a platform with no client that could receive the push', async () => {
    const db = fakeDatabase();
    const response = await register(db, { token: 'apns-token', platform: 'ios' });

    expect(response.statusCode).toBe(400);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO push_devices'))).toBe(false);
  });

  it('drops a caller supplied account id instead of registering against it', async () => {
    // Fastify's ajv strips unknown properties app-wide, so the extra key is
    // dropped rather than rejected. What matters is that the row is still
    // written against the authenticated account.
    const db = fakeDatabase();
    const response = await register(db, {
      token: 'fcm-token-value',
      platform: 'android',
      accountId: '00000000-0000-4000-8000-00000000000b'
    });

    expect(response.statusCode).toBe(201);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO push_devices'))!;
    expect(insert.values).toEqual([ME, 'android', 'fcm-token-value']);
  });

  it('refuses to register without a usable session', async () => {
    // The shared authorization header schema rejects a missing header before
    // the handler runs; a present but unusable token is the 401.
    const db = fakeDatabase();
    const missing = await appWith(db).inject({
      method: 'POST',
      url: '/v1/notifications/devices',
      payload: { token: 'fcm-token-value', platform: 'android' }
    });
    expect(missing.statusCode).toBe(400);

    const invalid = await appWith(db).inject({
      method: 'POST',
      url: '/v1/notifications/devices',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { token: 'fcm-token-value', platform: 'android' }
    });
    expect(invalid.statusCode).toBe(401);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO push_devices'))).toBe(false);
  });
});

describe('DELETE /v1/notifications/devices/:deviceId', () => {
  const revoke = (db: ReturnType<typeof fakeDatabase>, deviceId = DEVICE) =>
    appWith(db).inject({
      method: 'DELETE',
      url: `/v1/notifications/devices/${deviceId}`,
      headers: auth
    });

  it('revokes the caller own registration without deleting the audit row', async () => {
    const db = fakeDatabase();
    const response = await revoke(db);

    expect(response.statusCode).toBe(204);
    const update = db.calls.find((call) => call.sql.includes('UPDATE push_devices'))!;
    expect(update.sql).toContain("revoke_reason = 'signed_out'");
    expect(update.sql).not.toContain('DELETE');
    expect(update.values).toEqual([DEVICE, ME]);
  });

  it('scopes the revocation to the calling account', async () => {
    const db = fakeDatabase();
    await revoke(db);

    const update = db.calls.find((call) => call.sql.includes('UPDATE push_devices'))!;
    expect(update.sql).toContain('AND account_id = $2');
  });

  it('answers 204 for an id it did not match, so it cannot probe other accounts', async () => {
    const db = fakeDatabase({ revoked: [] });
    const response = await revoke(db);

    expect(response.statusCode).toBe(204);
    expect(db.calls.some((call) => call.sql.includes('privacy_audit_events'))).toBe(false);
  });

  it('refuses to revoke without a usable session', async () => {
    const db = fakeDatabase();
    const missing = await appWith(db).inject({
      method: 'DELETE',
      url: `/v1/notifications/devices/${DEVICE}`
    });
    expect(missing.statusCode).toBe(400);

    const invalid = await appWith(db).inject({
      method: 'DELETE',
      url: `/v1/notifications/devices/${DEVICE}`,
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    expect(invalid.statusCode).toBe(401);
    expect(db.calls.some((call) => call.sql.includes('UPDATE push_devices'))).toBe(false);
  });
});
