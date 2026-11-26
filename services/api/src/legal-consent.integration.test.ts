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
import { issueSession } from './auth.js';

/**
 * M9 9.26 against real PostgreSQL: a runner who agreed to older legal text is
 * asked again, agreeing records it once, and stale text can't be agreed to.
 * Accounts are erased afterwards (B19).
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'legal-consent-integration-secret' });
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
const signUp = async (policyVersion: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.18.1.${(nextClient += 1)}`,
    payload: {
      email: `consent-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-05-05',
      policyVersion
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  accounts.push(JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub);
  return { authorization: `Bearer ${token}` };
};

describePostgis('agreeing to updated legal text (M9 9.26)', () => {
  it('asks a runner who agreed to older text, and records their agreement once', async () => {
    // Sign-up records the server's current text, so an account that signed
    // up under older text is made directly, as one from before the change.
    const created = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
       VALUES ($1, 'not-a-real-hash', now(), '2026-11-22-draft') RETURNING id`,
      [`consent-${randomUUID()}@example.test`]
    );
    const id = created.rows[0]!.id;
    accounts.push(id);
    await db.query(
      `INSERT INTO consent_history (account_id, consent_type, granted, policy_version)
       VALUES ($1, 'age_assertion', true, '2026-11-22-draft')`,
      [id]
    );
    const session = await issueSession(db, id, 'legal-consent-integration-secret');
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const before = await app.inject({ method: 'GET', url: '/v1/legal/consent', headers });
    expect(before.json()).toEqual({
      currentVersion: LEGAL_POLICY_VERSION,
      acceptedVersion: '2026-11-22-draft',
      needsAcceptance: true
    });

    const stale = await app.inject({
      method: 'POST',
      url: '/v1/legal/consent',
      headers,
      payload: { policyVersion: '2026-11-22-draft' }
    });
    expect(stale.statusCode).toBe(409);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const agreed = await app.inject({
        method: 'POST',
        url: '/v1/legal/consent',
        headers,
        payload: { policyVersion: LEGAL_POLICY_VERSION }
      });
      expect(agreed.json()).toMatchObject({ needsAcceptance: false });
    }
    const rows = await db.query(
      `SELECT 1 FROM consent_history WHERE account_id = $1 AND consent_type = 'legal_policy'`,
      [accounts.at(-1)]
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('does not ask a runner who signed up under the current text', async () => {
    const headers = await signUp(LEGAL_POLICY_VERSION);
    const status = await app.inject({ method: 'GET', url: '/v1/legal/consent', headers });
    expect(status.json()).toMatchObject({ needsAcceptance: false });
  });

  it('records the text in force at sign-up, whatever version an old app sends', async () => {
    const headers = await signUp('an-old-build');
    const status = await app.inject({ method: 'GET', url: '/v1/legal/consent', headers });
    expect(status.json()).toMatchObject({
      acceptedVersion: LEGAL_POLICY_VERSION,
      needsAcceptance: false
    });
  });
});

describe('legal consent integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
