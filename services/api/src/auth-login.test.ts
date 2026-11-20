import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import type * as AuthModule from './auth.js';

/**
 * R6: login must cost the same whether or not the address has an account, so
 * response time does not reveal who is registered. Counted, not timed: a wall
 * clock test would be flaky, and the cost is the argon2 verification.
 */
const verifications = vi.hoisted(() => ({ count: 0 }));
vi.mock('./auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    verifyPassword: async (hash: string, password: string) => {
      verifications.count += 1;
      return actual.verifyPassword(hash, password);
    }
  };
});

const { buildApp } = await import('./app.js');
const { hashPassword } = await import('./auth.js');

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  verifications.count = 0;
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const appWithAccount = (account?: { id: string; password_hash: string }) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT id, password_hash FROM accounts'))
      return { rows: account ? [account] : [] };
    return { rows: [] };
  });
  const db = {
    query,
    connect: vi.fn(),
    end: vi.fn()
  } as unknown as Database;
  const app = buildApp({ db, authSecret: 'login-timing-test-secret' });
  apps.push(app);
  return app;
};

const login = (app: ReturnType<typeof buildApp>, email: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: `198.18.0.${Math.floor(Math.random() * 250) + 1}`,
    payload: { email, password }
  });

describe('login timing (R6)', () => {
  it('runs one argon2 verification for an unknown address, the same as for a wrong password', async () => {
    const unknown = await login(appWithAccount(), 'nobody@example.test', 'whatever-password');
    expect(unknown.statusCode).toBe(401);
    const forUnknown = verifications.count;

    verifications.count = 0;
    const hash = await hashPassword('the-real-password');
    const wrong = await login(
      appWithAccount({ id: '00000000-0000-4000-8000-000000000001', password_hash: hash }),
      'runner@example.test',
      'not-the-password'
    );
    expect(wrong.statusCode).toBe(401);

    expect(forUnknown).toBe(1);
    expect(verifications.count).toBe(1);
    expect(unknown.json()).toEqual(wrong.json());
  });
});
