import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { buildApp } from '@runsphere/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convergeAccountDeletion } from './worker.js';

/**
 * ADR-0012 end to end, against real PostgreSQL: the in-app request signs every
 * device out and blocks sign-in at once, and the worker's next sweep leaves
 * nothing behind but the abuse tombstone.
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'account-deletion-integration-secret' });
const PASSWORD = 'a-safe-deletion-password';

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

const register = async (email: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password: PASSWORD, ageAssertion: true, policyVersion: 'm2' }
  });
  expect(response.statusCode).toBe(201);
  const session = response.json() as { accessToken: string; refreshToken: string };
  const accountId = JSON.parse(
    Buffer.from(session.accessToken.split('.')[0]!, 'base64url').toString()
  ).sub as string;
  return { ...session, accountId };
};

describePostgis('account erasure (ADR-0012)', () => {
  it('requires the password, signs out everywhere, blocks sign-in, then erases', async () => {
    const email = `erase-${randomUUID()}@example.test`;
    const me = await register(email);
    const headers = { authorization: `Bearer ${me.accessToken}` };

    // Personal data in a few places, including one keyed only by address.
    await db.query(
      `INSERT INTO privacy_zones (account_id, name, center, geometry)
       SELECT $1, 'home', point, ST_Buffer(point::geography, 200)::geometry
       FROM (SELECT ST_SetSRID(ST_MakePoint(72.83, 19.05), 4326) AS point) synthetic`,
      [me.accountId]
    );
    await db.query(
      `INSERT INTO public_deletion_requests (email, verification_token_hash, expires_at)
       VALUES ($1, encode(digest($2, 'sha256'), 'hex'), now() + interval '1 day')`,
      [email, randomUUID()]
    );

    const wrong = await app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers,
      payload: { password: 'not-the-password' }
    });
    expect(wrong.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers,
      payload: { password: PASSWORD }
    });
    expect(accepted.statusCode).toBe(202);

    // Signed out everywhere: the refresh token no longer works.
    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: me.refreshToken }
    });
    expect(refresh.statusCode).toBe(401);

    // Signing in again does not resurrect the account.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: PASSWORD }
    });
    expect(login.statusCode).toBe(401);

    // The worker's sweep erases it.
    let erased = 0;
    for (let sweep = 0; sweep < 5; sweep += 1) {
      erased += await convergeAccountDeletion(db);
      const gone = await db.query('SELECT 1 FROM accounts WHERE id = $1', [me.accountId]);
      if (gone.rows.length === 0) break;
    }
    expect(erased).toBeGreaterThan(0);

    const remaining = await db.query<{ table_name: string; count: string }>(
      `SELECT 'accounts' AS table_name, count(*)::text FROM accounts WHERE id = $1
       UNION ALL SELECT 'privacy_zones', count(*)::text FROM privacy_zones WHERE account_id = $1
       UNION ALL SELECT 'consent_history', count(*)::text FROM consent_history WHERE account_id = $1
       UNION ALL SELECT 'refresh_token_families', count(*)::text FROM refresh_token_families WHERE account_id = $1
       UNION ALL SELECT 'privacy_audit_events', count(*)::text FROM privacy_audit_events WHERE account_id = $1
       UNION ALL SELECT 'public_deletion_requests', count(*)::text FROM public_deletion_requests WHERE lower(email) = lower($2)`,
      [me.accountId, email]
    );
    for (const row of remaining.rows)
      expect({ [row.table_name]: row.count }).toEqual({ [row.table_name]: '0' });

    const tombstone = await db.query(
      'SELECT 1 FROM account_deletion_tombstones WHERE account_id = $1',
      [me.accountId]
    );
    expect(tombstone.rows).toHaveLength(1);
  });
});

describe('account erasure integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
