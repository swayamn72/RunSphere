import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled
} from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * R3 against real PostgreSQL: an access token stops working as soon as its
 * session is signed out or its account is deleted, instead of lasting until
 * it expires 15 minutes later.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'session-check-integration-secret', sessionChecks: true });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

let nextClient = 0;
const signUp = async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.51.100.${60 + (nextClient += 1)}`,
    payload: {
      email: `session-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1992-04-10',
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { accessToken: string; refreshToken: string };
};

const identity = (accessToken: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/account/identity',
    headers: { authorization: `Bearer ${accessToken}` }
  });

describePostgis('access tokens end with their session (R3)', () => {
  it('works while the session is live', async () => {
    const session = await signUp();
    expect((await identity(session.accessToken)).statusCode).toBe(200);
  });

  it('stops working the moment the session signs out', async () => {
    const session = await signUp();
    const out = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: session.refreshToken }
    });
    expect(out.statusCode).toBeLessThan(300);
    expect((await identity(session.accessToken)).statusCode).toBe(401);
  });

  it('stops working once the account asks to be deleted', async () => {
    const session = await signUp();
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { password: 'a-safe-pilot-password' }
    });
    expect(deleted.statusCode).toBeLessThan(300);
    expect((await identity(session.accessToken)).statusCode).toBe(401);
  });

  it('signs out one device without touching another', async () => {
    const first = await signUp();
    const email = (
      await db.query<{ email: string }>(
        `SELECT email FROM accounts WHERE id = (
           SELECT account_id FROM refresh_token_families ORDER BY created_at DESC LIMIT 1)`
      )
    ).rows[0]!.email;
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '198.51.100.250',
      payload: { email, password: 'a-safe-pilot-password' }
    });
    const other = second.json() as { accessToken: string };
    await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: first.refreshToken }
    });
    expect((await identity(first.accessToken)).statusCode).toBe(401);
    expect((await identity(other.accessToken)).statusCode).toBe(200);
  });
});
