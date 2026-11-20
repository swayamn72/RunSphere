import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken, hashPassword } from './auth.js';

/**
 * ADR-0012: in-app erasure needs the current password, signs every device out
 * at once, and a pending erasure cannot be undone by signing back in. The web
 * pages are the Play-required public path and must never delete on a GET.
 */

const SECRET = 'account-deletion-test-secret';
const ME = '00000000-0000-4000-8000-0000000000e1';
const PASSWORD = 'correct horse battery staple';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

const fakeDatabase = (options: { accountExists?: boolean } = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT password_hash FROM accounts'))
      return { rows: options.accountExists === false ? [] : [{ password_hash: passwordHash }] };
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

const deleteAccount = (db: ReturnType<typeof fakeDatabase>, payload?: Record<string, unknown>) =>
  appWith(db).inject({
    method: 'DELETE',
    url: '/v1/account',
    headers: auth,
    ...(payload ? { payload } : {})
  });

describe('DELETE /v1/account', () => {
  it('schedules erasure, revokes every session, and stops shares when the password matches', async () => {
    const db = fakeDatabase();
    const response = await deleteAccount(db, { password: PASSWORD });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'scheduled' });
    const sql = db.calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('deletion_requested_at');
    expect(sql).toContain('UPDATE refresh_token_families SET revoked_at');
    expect(sql).toContain('UPDATE safety_share_sessions');
    expect(sql).toContain('account_deletion.requested');
    expect(sql).toContain('COMMIT');
  });

  it('refuses a wrong password and changes nothing', async () => {
    const db = fakeDatabase();
    const response = await deleteAccount(db, { password: 'not the password' });

    expect(response.statusCode).toBe(403);
    expect(db.calls.some((call) => call.sql.includes('deletion_requested_at'))).toBe(false);
  });

  it('refuses a request with no password at all', async () => {
    const db = fakeDatabase();
    const response = await deleteAccount(db);

    expect(response.statusCode).toBe(400);
    expect(db.calls.some((call) => call.sql.includes('deletion_requested_at'))).toBe(false);
  });

  it('requires a valid bearer token', async () => {
    const db = fakeDatabase();
    // Missing header: rejected by the header schema, as on every route.
    const missing = await appWith(db).inject({
      method: 'DELETE',
      url: '/v1/account',
      payload: { password: PASSWORD }
    });
    expect(missing.statusCode).toBe(400);
    // Forged token: rejected by the handler.
    const forged = await appWith(db).inject({
      method: 'DELETE',
      url: '/v1/account',
      headers: { authorization: `Bearer ${createAccessToken(ME, 'some-other-secret')}` },
      payload: { password: PASSWORD }
    });
    expect(forged.statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it('answers 401 for an account that is already gone', async () => {
    const db = fakeDatabase({ accountExists: false });
    const response = await deleteAccount(db, { password: PASSWORD });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /v1/auth/login during a pending erasure', () => {
  it('only looks up accounts with no erasure requested', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'runner@example.test', password: PASSWORD }
    });

    // The fake returns no rows for the login lookup, exactly as the real
    // filter would for a pending erasure: the generic failure, nothing more.
    expect(response.statusCode).toBe(401);
    const lookup = db.calls.find((call) =>
      call.sql.includes('SELECT id, password_hash FROM accounts')
    );
    expect(lookup?.sql).toContain('deletion_requested_at IS NULL');
    expect(lookup?.sql).toContain('deleted_at IS NULL');
  });
});

describe('public deletion pages', () => {
  it.each(['/account/delete', '/confirm-deletion?token=abc'])(
    '%s is a self-contained page that touches no data on GET',
    async (url) => {
      const db = fakeDatabase();
      const response = await appWith(db).inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.body).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
      expect(db.calls).toHaveLength(0);
    }
  );

  it('confirms only from a button press, posting the token in the body', async () => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'GET',
      url: '/confirm-deletion?token=abc'
    });

    expect(response.body).toContain("addEventListener('click'");
    expect(response.body).toContain('/v1/account/deletion-request/complete');
    expect(response.body).toContain('JSON.stringify({ token })');
  });
});
