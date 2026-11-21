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
 * ADR-0014 against real PostgreSQL: sign-up with a date of birth and a
 * username, the privacy settings, and the rule that search, profiles and
 * friend requests never show a runner more than their settings allow.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'social-identity-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

let nextClient = 0;
const suffix = () => randomUUID().replace(/-/g, '').slice(0, 8);

const signUp = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `203.0.113.${(nextClient += 1) % 250}`,
    payload: {
      email: `id-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      policyVersion: 'm2',
      ...payload
    }
  });

interface Runner {
  token: string;
  id: string;
  username: string;
}

const runner = async (prefix = 'run'): Promise<Runner> => {
  const username = `${prefix}_${suffix()}`;
  const response = await signUp({ dateOfBirth: '1995-06-15', username });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  return { token, id, username };
};

const as = (who: Runner) => ({ authorization: `Bearer ${who.token}` });

const settle = (who: Runner, settings: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: '/v1/privacy-settings', headers: as(who), payload: settings });

const befriend = async (a: Runner, b: Runner) => {
  await app.inject({
    method: 'POST',
    url: '/v1/friends/requests',
    headers: as(a),
    payload: { username: b.username }
  });
  const pending = await app.inject({ method: 'GET', url: '/v1/friends/requests', headers: as(b) });
  const request = (pending.json() as { data: { id: string; accountId: string }[] }).data.find(
    (entry) => entry.accountId === a.id
  );
  expect(request).toBeDefined();
  await app.inject({
    method: 'POST',
    url: `/v1/friends/requests/${request!.id}/respond`,
    headers: as(b),
    payload: { accept: true }
  });
};

const search = async (reader: Runner, q: string) =>
  (
    (
      await app.inject({
        method: 'GET',
        url: `/v1/profiles/search?q=${encodeURIComponent(q)}`,
        headers: as(reader)
      })
    ).json() as { data: { username: string }[] }
  ).data.map((profile) => profile.username);

const profileStatus = async (reader: Runner, username: string) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/profiles/by-username/${username}`,
      headers: as(reader)
    })
  ).statusCode;

describePostgis('sign-up with date of birth and username (ADR-0014)', () => {
  it('refuses under-18s and accepts adults with their chosen username', async () => {
    const minor = await signUp({ dateOfBirth: '2015-01-01', username: `kid_${suffix()}` });
    expect(minor.statusCode).toBe(400);
    expect((minor.json() as { message: string }).message).toMatch(/18 or older/);

    const adult = await runner('adult');
    const identity = await app.inject({
      method: 'GET',
      url: '/v1/account/identity',
      headers: as(adult)
    });
    expect(identity.json()).toEqual({ username: adult.username, hasDateOfBirth: true });
  });

  it('says a taken username is taken, and refuses bad names and unknown areas', async () => {
    const first = await runner('taken');
    const again = await signUp({
      dateOfBirth: '1990-01-01',
      username: first.username.toUpperCase()
    });
    expect(again.statusCode).toBe(409);
    expect((await signUp({ dateOfBirth: '1990-01-01', username: 'admin' })).statusCode).toBe(400);
    expect(
      (
        await signUp({
          dateOfBirth: '1990-01-01',
          username: `area_${suffix()}`,
          homeArea: '14 Hill Road'
        })
      ).statusCode
    ).toBe(400);

    const check = await app.inject({
      method: 'GET',
      url: `/v1/usernames/${first.username}/availability`
    });
    expect(check.json()).toMatchObject({ available: false });
  });

  it('still accepts the legacy age checkbox and generates a username', async () => {
    const legacy = await signUp({ ageAssertion: true });
    expect(legacy.statusCode).toBe(201);
    const token = (legacy.json() as { accessToken: string }).accessToken;
    const identity = await app.inject({
      method: 'GET',
      url: '/v1/account/identity',
      headers: { authorization: `Bearer ${token}` }
    });
    expect((identity.json() as { username: string }).username).toMatch(/^runner_[0-9a-f]{12}$/);
    expect((await signUp({})).statusCode).toBe(400);
  });

  it('gives a new sign-up the public defaults, and saving marks them reviewed', async () => {
    const fresh = await runner('fresh');
    const settings = await app.inject({
      method: 'GET',
      url: '/v1/privacy-settings',
      headers: as(fresh)
    });
    expect(settings.json()).toMatchObject({
      profileVisibility: 'everyone',
      searchable: true,
      runsVisibility: 'friends',
      showStartTimes: false,
      reviewed: false
    });
    const saved = await settle(fresh, { ghostRaces: false });
    expect(saved.json()).toMatchObject({ ghostRaces: false, reviewed: true });
  });
});

describePostgis('search and profiles respect every runner’s settings (ADR-0014)', () => {
  it('shows public runners, hides friends-only ones from strangers, and never shows only-me', async () => {
    const tag = suffix();
    const reader = await runner(`r${tag}`);
    const open = await runner(`o${tag}`);
    const friendsOnly = await runner(`f${tag}`);
    const hidden = await runner(`h${tag}`);
    const unsearchable = await runner(`u${tag}`);
    await settle(friendsOnly, { profileVisibility: 'friends' });
    await settle(hidden, { profileVisibility: 'only_me' });
    await settle(unsearchable, { searchable: false });

    for (const who of [open, friendsOnly, hidden, unsearchable]) await search(reader, who.username);
    expect(await search(reader, open.username)).toEqual([open.username]);
    expect(await search(reader, friendsOnly.username)).toEqual([]);
    expect(await search(reader, hidden.username)).toEqual([]);
    expect(await search(reader, unsearchable.username)).toEqual([]);

    expect(await profileStatus(reader, open.username)).toBe(200);
    expect(await profileStatus(reader, friendsOnly.username)).toBe(404);
    expect(await profileStatus(reader, hidden.username)).toBe(404);
    // Not searchable is still reachable by its exact link or QR code.
    expect(await profileStatus(reader, unsearchable.username)).toBe(200);

    // Once friends, the friends-only runner appears.
    await befriend(friendsOnly, reader);
    expect(await search(reader, friendsOnly.username)).toEqual([friendsOnly.username]);
    expect(await profileStatus(reader, friendsOnly.username)).toBe(200);
    // Only me stays hidden even from a friend.
    await befriend(hidden, reader);
    expect(await profileStatus(reader, hidden.username)).toBe(404);
  });

  it('hides a runner from someone they blocked, both ways', async () => {
    const tag = suffix();
    const blocker = await runner(`b${tag}`);
    const blocked = await runner(`x${tag}`);
    await app.inject({
      method: 'POST',
      url: '/v1/blocks',
      headers: as(blocker),
      payload: { accountId: blocked.id }
    });
    expect(await search(blocked, blocker.username)).toEqual([]);
    expect(await profileStatus(blocked, blocker.username)).toBe(404);
    expect(await profileStatus(blocker, blocked.username)).toBe(404);
  });

  it('treats % and _ in a search as letters, not wildcards', async () => {
    const reader = await runner('wild');
    expect(await search(reader, '%%')).toEqual([]);
  });
});

describePostgis('friend requests by username follow "who can send me requests"', () => {
  it('delivers when open, and silently drops when set to nobody', async () => {
    const tag = suffix();
    const sender = await runner(`s${tag}`);
    const open = await runner(`a${tag}`);
    const closed = await runner(`n${tag}`);
    await settle(closed, { friendRequestsFrom: 'nobody' });

    const profile = await app.inject({
      method: 'GET',
      url: `/v1/profiles/by-username/${closed.username}`,
      headers: as(sender)
    });
    expect((profile.json() as { canSendRequest: boolean }).canSendRequest).toBe(false);

    for (const target of [open, closed]) {
      const sent = await app.inject({
        method: 'POST',
        url: '/v1/friends/requests',
        headers: as(sender),
        payload: { username: `@${target.username.toUpperCase()}` }
      });
      expect(sent.statusCode).toBe(202);
    }
    const pending = async (who: Runner) =>
      (
        (
          await app.inject({ method: 'GET', url: '/v1/friends/requests', headers: as(who) })
        ).json() as { data: unknown[] }
      ).data.length;
    expect(await pending(open)).toBe(1);
    expect(await pending(closed)).toBe(0);
  });
});
