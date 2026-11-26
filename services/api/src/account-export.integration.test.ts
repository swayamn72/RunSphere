import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi,
  withTransaction
} from '@runsphere/db';
import { LEGAL_POLICY_VERSION } from '@runsphere/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * "See and download your data" against real PostgreSQL: the export covers
 * what the privacy notice lists, names other runners only by username, and
 * never carries a secret. Accounts are erased afterwards (B19).
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'account-export-integration-secret' });
const accounts: string[] = [];

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled) {
    await withTransaction(db, async (client) => {
      await client.query("SELECT set_config('runsphere.account_erasure', 'on', true)");
      await client.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accounts]);
    });
  }
  await app.close();
  await db.end();
});

let nextClient = 0;
const signUp = async (username: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.18.2.${(nextClient += 1)}`,
    payload: {
      email: `export-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-05-05',
      username,
      policyVersion: LEGAL_POLICY_VERSION
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  accounts.push(id);
  return { id, headers: { authorization: `Bearer ${token}` } };
};

const suffix = () => randomUUID().replace(/-/g, '').slice(0, 8);

describePostgis('account export', () => {
  it('covers the account, settings, zones, friends and agreements, and no secrets', async () => {
    const runnerName = `exp_${suffix()}`;
    const friendName = `exf_${suffix()}`;
    const runner = await signUp(runnerName);
    const friend = await signUp(friendName);
    await db.query(
      `INSERT INTO friendships (account_id, friend_account_id) VALUES ($1, $2), ($2, $1)`,
      [runner.id, friend.id]
    );
    const zone = await app.inject({
      method: 'POST',
      url: '/v1/privacy-zones',
      headers: runner.headers,
      payload: { name: 'Home', center: { latitude: 19.07, longitude: 72.88 } }
    });
    expect(zone.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/account/export',
      headers: runner.headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      data: {
        account: { username: string; emailVerified: boolean };
        privacySettings: { runsVisibility: string } | null;
        privacyZones: { name: string }[];
        runs: unknown[];
        friends: { username: string }[];
        agreements: { kind: string; version: string }[];
      };
    };
    expect(body.status).toBe('ready');
    expect(body.data.account).toMatchObject({ username: runnerName, emailVerified: false });
    expect(body.data.privacySettings).toMatchObject({ runsVisibility: 'friends' });
    expect(body.data.privacyZones.map((z) => z.name)).toEqual(['Home']);
    expect(body.data.runs).toEqual([]);
    expect(body.data.friends).toEqual([expect.objectContaining({ username: friendName })]);
    expect(body.data.agreements).toEqual([
      expect.objectContaining({ kind: 'age_assertion', version: LEGAL_POLICY_VERSION })
    ]);
    expect(response.body).not.toMatch(/password|argon|token/i);
    expect(response.body).not.toContain(friend.id);
  });

  it('needs a signed-in runner', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/account/export',
      headers: { authorization: 'Bearer not-a-session' }
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('account export integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
