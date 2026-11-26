import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * M1.2 against real PostgreSQL. A refresh token replayed within a few seconds
 * of its first use is a client retrying after a lost response, and gets a new
 * token. A replay after that window is treated as theft and revokes the whole
 * session, exactly as before.
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'auth-refresh-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

let nextClient = 0;
const register = async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.51.100.${200 + (nextClient += 1)}`,
    payload: {
      email: `refresh-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-01-01',
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { accessToken: string; refreshToken: string };
};

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

/** Pretend the token was first used `seconds` ago. */
const ageFirstUse = (refreshToken: string, seconds: number) =>
  db.query(
    `UPDATE refresh_tokens SET used_at = now() - $2::interval
     WHERE selector_hash = encode(digest($1, 'sha256'), 'hex')`,
    [refreshToken.split('.')[0], `${seconds} seconds`]
  );

describePostgis('refresh token reuse window (M1.2)', () => {
  it('lets a client retry a refresh whose response it lost, without signing it out', async () => {
    const session = await register();
    const first = await refresh(session.refreshToken);
    expect(first.statusCode).toBe(200);

    // The response above never reached the phone; it retries with the old token.
    const retry = await refresh(session.refreshToken);
    expect(retry.statusCode).toBe(200);

    // The session is intact: the retried token keeps rotating normally.
    const next = await refresh((retry.json() as { refreshToken: string }).refreshToken);
    expect(next.statusCode).toBe(200);
  });

  it('still revokes the whole session when a spent token is replayed later', async () => {
    const session = await register();
    const first = await refresh(session.refreshToken);
    expect(first.statusCode).toBe(200);
    await ageFirstUse(session.refreshToken, 120);

    const replay = await refresh(session.refreshToken);
    expect(replay.statusCode).toBe(401);
    // Theft response: the legitimate successor dies with it.
    const successor = await refresh((first.json() as { refreshToken: string }).refreshToken);
    expect(successor.statusCode).toBe(401);
  });

  it('does not revive a revoked session inside the window', async () => {
    const session = await register();
    expect((await refresh(session.refreshToken)).statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: session.refreshToken }
    });

    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
  });
});

describe('refresh reuse window integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
