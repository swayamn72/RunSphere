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
 * M3.6 against real PostgreSQL: the accepted safety contact can find the
 * shares sent to them, nobody else can, and a stopped share drops out. The
 * list carries who and until when, never a location.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'safety-received-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

let nextClient = 0;
interface Member {
  token: string;
  id: string;
  email: string;
}

/** A signed-up runner whose email is verified and trusted, as sharing requires. */
const member = async (prefix: string): Promise<Member> => {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.51.100.${30 + (nextClient += 1)}`,
    payload: {
      email,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-02-02',
      username: `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  await db.query(
    `UPDATE accounts SET email_verified_at = now(), email_verification_status = 'verified',
       trust_established_at = now() WHERE id = $1`,
    [id]
  );
  return { token, id, email };
};

const as = (who: Member) => ({ authorization: `Bearer ${who.token}` });

const received = async (who: Member) =>
  (
    (
      await app.inject({ method: 'GET', url: '/v1/safety-shares/received', headers: as(who) })
    ).json() as { data: { id: string; sharerUsername: string }[] }
  ).data;

describePostgis('safety shares sent to you (M3.6)', () => {
  it('lists an active share for its accepted contact only, and drops it once stopped', async () => {
    const sharer = await member('sharer');
    const contact = await member('contact');
    const outsider = await member('outsider');

    const invited = await app.inject({
      method: 'POST',
      url: '/v1/safety-contacts',
      headers: as(sharer),
      payload: { email: contact.email }
    });
    expect(invited.statusCode).toBe(201);
    const contactId = (invited.json() as { id: string }).id;

    // Not accepted yet: nothing to see.
    const started = await app.inject({
      method: 'POST',
      url: '/v1/safety-shares',
      headers: as(sharer),
      payload: { safetyContactId: contactId, durationMinutes: 60 }
    });
    if (started.statusCode === 201) expect(await received(contact)).toEqual([]);

    await app.inject({
      method: 'POST',
      url: `/v1/safety-contacts/${contactId}/accept`,
      headers: as(contact)
    });
    const share = await app.inject({
      method: 'POST',
      url: '/v1/safety-shares',
      headers: as(sharer),
      payload: { safetyContactId: contactId, durationMinutes: 60 }
    });
    expect(share.statusCode).toBe(201);
    const shareId = (share.json() as { id: string }).id;

    const list = await received(contact);
    expect(list.map((entry) => entry.id)).toContain(shareId);
    const entry = list.find((candidate) => candidate.id === shareId)!;
    expect(entry.sharerUsername).toMatch(/^sharer_/);
    expect(JSON.stringify(entry)).not.toMatch(/latitude|longitude|tile/i);

    expect(await received(outsider)).toEqual([]);
    expect(await received(sharer)).toEqual([]);

    await app.inject({
      method: 'DELETE',
      url: `/v1/safety-shares/${shareId}`,
      headers: as(sharer)
    });
    expect((await received(contact)).map((candidate) => candidate.id)).not.toContain(shareId);
  });

  it('hides a share once it has expired', async () => {
    const sharer = await member('expsharer');
    const contact = await member('expcontact');
    const invited = await app.inject({
      method: 'POST',
      url: '/v1/safety-contacts',
      headers: as(sharer),
      payload: { email: contact.email }
    });
    const contactId = (invited.json() as { id: string }).id;
    await app.inject({
      method: 'POST',
      url: `/v1/safety-contacts/${contactId}/accept`,
      headers: as(contact)
    });
    const share = await app.inject({
      method: 'POST',
      url: '/v1/safety-shares',
      headers: as(sharer),
      payload: { safetyContactId: contactId, durationMinutes: 60 }
    });
    const shareId = (share.json() as { id: string }).id;
    await db.query(
      `UPDATE safety_share_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [shareId]
    );
    expect((await received(contact)).map((candidate) => candidate.id)).not.toContain(shareId);
  });
});
