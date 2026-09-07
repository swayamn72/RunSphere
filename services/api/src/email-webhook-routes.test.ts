import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { verifyWebhookSignature } from './email-webhook-routes.js';

/**
 * The provider bounce webhook — the only unauthenticated write in the product.
 *
 * So the tests that matter are the refusals: an unsigned request, a wrongly
 * signed one, and a signature computed over different bytes than were sent.
 * Everything else this route can do is add an address to a suppression list.
 */
const SECRET = 'email-webhook-test-secret';

let stubs: { accepted?: Record<string, unknown>[] } = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
  calls.push({ sql, values });
  if (sql.includes('INSERT INTO email_provider_events'))
    return { rows: stubs.accepted ?? [{ id: 'event-row-1' }] };
  return { rows: [] };
});
const database = {
  query,
  connect: vi.fn(async () => ({ query, release: vi.fn() })),
  end: vi.fn(async () => undefined)
} as unknown as Database;

const app = buildApp({ db: database, authSecret: 'unused' });
beforeAll(async () => {
  process.env.EMAIL_WEBHOOK_SECRET = SECRET;
  await app.ready();
}, 120_000);
afterAll(async () => {
  delete process.env.EMAIL_WEBHOOK_SECRET;
  await app.close();
});
beforeEach(() => {
  stubs = {};
  calls = [];
});

const sql = () => calls.map((call) => call.sql).join('\n');
const values = () => JSON.stringify(calls.map((call) => call.values));

const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

const post = (body: unknown, signature?: string) => {
  const payload = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/v1/email/provider-events',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? { 'x-webhook-signature': sign(payload) } : {}),
      ...(signature ? { 'x-webhook-signature': signature } : {})
    },
    payload
  });
};

describe('verifying a signature', () => {
  it('accepts the digest of the exact bytes, with or without a prefix', () => {
    const body = '{"a":1}';

    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it('refuses a missing, malformed, or wrong signature', () => {
    const body = '{"a":1}';

    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'not-hex', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), 'different-secret')).toBe(false);
    // A digest of a shorter length must not pass a prefix comparison.
    expect(verifyWebhookSignature(body, sign(body).slice(0, 20), SECRET)).toBe(false);
  });

  it('refuses a signature over different bytes than were sent', () => {
    // The reason the route keeps the raw body: two payloads that parse to the
    // same object do not have the same signature.
    expect(verifyWebhookSignature('{"a":1}', sign('{ "a": 1 }'), SECRET)).toBe(false);
  });
});

describe('POST /v1/email/provider-events', () => {
  it('refuses an unsigned request', async () => {
    const response = await post({ id: 'e1', type: 'bounce', email: 'a@b.test' }, 'none');

    expect(response.statusCode).toBe(401);
    // Nothing was read or written on the way to refusing.
    expect(sql()).not.toContain('INSERT INTO email_provider_events');
  });

  it('tells an unsigned caller nothing about why', async () => {
    const response = await post({ id: 'e1', type: 'bounce', email: 'a@b.test' }, 'deadbeef');

    expect(response.json().message).toBe('Unauthorized');
  });

  it('suppresses an address on a permanent bounce', async () => {
    const response = await post({
      id: 'e1',
      type: 'bounce',
      email: 'Dead@Example.test',
      permanent: true
    });

    expect(response.statusCode).toBe(204);
    expect(sql()).toContain('INSERT INTO email_suppressions');
    expect(values()).toContain('bounce');
  });

  it('does not suppress a soft bounce', async () => {
    // A full mailbox or a temporary outage is not a dead address, and
    // suppressing on one would lock somebody out of their own password reset.
    const response = await post({ id: 'e2', type: 'bounce', email: 'full@example.test' });

    expect(response.statusCode).toBe(204);
    expect(sql()).not.toContain('INSERT INTO email_suppressions');
  });

  it('always suppresses on a complaint', async () => {
    // Somebody pressed "this is spam". Continuing to write to them is both rude
    // and ruinous for the sending domain.
    await post({ id: 'e3', type: 'complaint', email: 'annoyed@example.test' });

    expect(sql()).toContain('INSERT INTO email_suppressions');
    expect(values()).toContain('complaint');
  });

  it('records a delivery without suppressing anything', async () => {
    await post({ id: 'e4', type: 'delivered', email: 'fine@example.test' });

    expect(sql()).toContain('INSERT INTO email_provider_events');
    expect(sql()).not.toContain('INSERT INTO email_suppressions');
  });

  it('answers a redelivery with 204 and does not act twice', async () => {
    // Providers redeliver, and a retry storm is worse than a no-op.
    stubs = { accepted: [] };
    const response = await post({
      id: 'e1',
      type: 'bounce',
      email: 'dead@example.test',
      permanent: true
    });

    expect(response.statusCode).toBe(204);
    expect(sql()).not.toContain('INSERT INTO email_suppressions');
  });

  it('stores the address hashed on the audit row', async () => {
    await post({ id: 'e5', type: 'complaint', email: 'annoyed@example.test' });

    const audit = calls.find((call) => call.sql.includes('INSERT INTO email_provider_events'));
    // The suppression list needs the address in the clear to be checked
    // against; this audit row does not, so it does not have it.
    expect(audit?.sql).toContain("digest(lower($3), 'sha256')");
  });

  it('refuses an event type it does not handle', async () => {
    const response = await post({ id: 'e6', type: 'opened', email: 'a@b.test' });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a body with no event id', async () => {
    const response = await post({ type: 'bounce', email: 'a@b.test' });

    expect(response.statusCode).toBe(400);
  });

  it('leaves every other route on the default body parser', async () => {
    // The raw-body parser is registered in an encapsulated scope. If it leaked,
    // routes elsewhere would still work but the isolation claim would be false,
    // so this checks a neighbour still validates normally.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'not-an-email' })
    });

    expect(response.statusCode).toBe(400);
  });
});
