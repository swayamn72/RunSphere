import { describe, expect, it } from 'vitest';
import { ApiFailure, MobileApiClient } from './api-client.js';
import { createAuthStorage, type SecureKeyValueStore } from './auth-storage-core.js';
import { AuthFailure } from './auth-failure.js';

class MemorySecureStore implements SecureKeyValueStore {
  private readonly values = new Map<string, string>();
  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresInSeconds: 900
};

describe('mobile API auth client', () => {
  it('registers and persists the returned bearer and refresh tokens', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    const fetcher = async () => new Response(JSON.stringify(session), { status: 201 });
    const client = new MobileApiClient('https://api.runsphere.test', fetcher, storage);
    await expect(
      client.register({
        email: 'maya@example.com',
        password: 'long-enough-password',
        ageAssertion: true,
        policyVersion: 'm1'
      })
    ).resolves.toEqual(session);
    await expect(storage.read()).resolves.toEqual(session);
  });

  it('classifies duplicate registration without exposing the server response body', async () => {
    const client = new MobileApiClient(
      'https://api.runsphere.test',
      async () =>
        new Response(JSON.stringify({ message: 'sensitive server detail' }), { status: 409 })
    );

    await expect(
      client.register({
        email: 'maya@example.com',
        password: 'long-enough-password',
        ageAssertion: true,
        policyVersion: 'm1'
      })
    ).rejects.toMatchObject({
      name: 'AuthFailure',
      kind: 'account-exists',
      status: 409,
      message:
        'An account may already exist for this email. Sign in instead, or use a different email.'
    });
  });

  it.each([
    [new TypeError('Network request failed'), 'network'],
    [new Error('SSLHandshakeException: Trust anchor not found'), 'tls']
  ])('classifies transport failures safely', async (transportError, expectedKind) => {
    const client = new MobileApiClient('https://api.runsphere.test', async () => {
      throw transportError;
    });

    const request = client.login({ email: 'maya@example.com', password: 'long-enough-password' });
    await expect(request).rejects.toBeInstanceOf(AuthFailure);
    await expect(request).rejects.toMatchObject({ kind: expectedKind });
  });

  it('does not clear secure storage until account-scoped cleanup runs', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    await storage.save(session);
    const client = new MobileApiClient(
      'https://api.runsphere.test',
      async () => new Response(null, { status: 204 }),
      storage
    );
    await client.logout();
    await expect(storage.read()).resolves.toEqual(session);
  });

  it('rotates persisted tokens through the refresh endpoint', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    await storage.save(session);
    const rotated = { ...session, accessToken: 'rotated-access', refreshToken: 'rotated-refresh' };
    const client = new MobileApiClient(
      'https://api.runsphere.test',
      async () => new Response(JSON.stringify(rotated)),
      storage
    );
    await expect(client.refresh()).resolves.toEqual(rotated);
    await expect(storage.read()).resolves.toEqual(rotated);
  });
});

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly authorization?: string;
  readonly body?: string;
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });

/** Signed-in client that records every outbound call for boundary assertions. */
const recordingClient = async (
  responder: (call: RecordedCall) => Response
): Promise<{ client: MobileApiClient; calls: RecordedCall[] }> => {
  const storage = createAuthStorage(new MemorySecureStore());
  await storage.save(session);
  const calls: RecordedCall[] = [];
  const client = new MobileApiClient(
    'https://api.runsphere.test',
    async (input, init) => {
      const authorization = new Headers(init?.headers).get('authorization');
      const call: RecordedCall = {
        url: String(input),
        method: init?.method ?? 'GET',
        ...(authorization ? { authorization } : {}),
        ...(typeof init?.body === 'string' ? { body: init.body } : {})
      };
      calls.push(call);
      return responder(call);
    },
    storage
  );
  return { client, calls };
};

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Maya',
  cosmetic: { avatarKey: 'loop-default' },
  activityVisibility: 'private' as const
};

describe('mobile gamification API client', () => {
  it('reads the account profile with the stored bearer session', async () => {
    const { client, calls } = await recordingClient(() => json(profile));
    await expect(client.getProfile()).resolves.toEqual(profile);
    expect(calls).toEqual([
      {
        url: 'https://api.runsphere.test/v1/profile',
        method: 'GET',
        authorization: 'Bearer access-token'
      }
    ]);
  });

  it('surfaces a missing profile as a 404 failure instead of an empty identity', async () => {
    const { client } = await recordingClient(() => json({ message: 'Profile not found' }, 404));
    const request = client.getProfile();
    await expect(request).rejects.toBeInstanceOf(ApiFailure);
    await expect(request).rejects.toMatchObject({ status: 404, message: 'Profile not found' });
  });

  it('unwraps friend, request, inbox, and achievement list envelopes', async () => {
    const friendRequest = {
      id: '22222222-2222-4222-8222-222222222222',
      accountId: profile.id,
      counterpartProfile: profile,
      status: 'pending' as const,
      createdAt: '2026-09-01T04:00:00.000Z'
    };
    const inboxEntry = {
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'friend_request' as const,
      title: 'New friend request',
      body: 'Someone sent you a friend request.',
      createdAt: '2026-09-01T04:00:00.000Z'
    };
    const achievement = {
      key: 'first-quest',
      ruleVersion: 'progression-1',
      title: 'First quest',
      description: 'Complete a curated quest.',
      rewardXp: 50,
      earned: false
    };
    const { client } = await recordingClient((call) => {
      if (call.url.endsWith('/v1/friends')) return json({ data: [profile] });
      if (call.url.endsWith('/v1/friends/requests')) return json({ data: [friendRequest] });
      if (call.url.endsWith('/v1/notifications')) return json({ data: [inboxEntry] });
      return json({ data: [achievement] });
    });

    await expect(client.listFriends()).resolves.toEqual([profile]);
    await expect(client.listFriendRequests()).resolves.toEqual([friendRequest]);
    await expect(client.getNotificationInbox()).resolves.toEqual([inboxEntry]);
    await expect(client.getAchievements()).resolves.toEqual([achievement]);
  });

  it('keeps the friend request response generic so an address is never confirmed', async () => {
    const { client, calls } = await recordingClient(() => json({ status: 'recorded' }, 202));
    await expect(client.sendFriendRequest({ email: 'friend@example.com' })).resolves.toEqual({
      status: 'recorded'
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe(JSON.stringify({ email: 'friend@example.com' }));
  });

  it('treats 204 acknowledgements as empty and encodes path parameters', async () => {
    const { client, calls } = await recordingClient(() => new Response(null, { status: 204 }));
    await expect(client.respondFriendRequest('req/44', true)).resolves.toBeUndefined();
    await expect(client.markNotificationsRead(['note-55'])).resolves.toBeUndefined();
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        'POST',
        'https://api.runsphere.test/v1/friends/requests/req%2F44/respond',
        JSON.stringify({ accept: true })
      ],
      [
        'POST',
        'https://api.runsphere.test/v1/notifications/read',
        JSON.stringify({ ids: ['note-55'] })
      ]
    ]);
  });

  it('reads the server-owned progression summary without deriving XP locally', async () => {
    const summary = {
      totalXp: 420,
      questsCompleted: 3,
      achievements: [],
      weeklyConsistency: {
        periodStart: '2026-08-31',
        activeDays: 4,
        cappedActiveMinutes: 180,
        goalActiveDays: 5,
        current: true
      },
      level: { level: 3, xpInLevel: 20, nextLevelAt: 100 }
    };
    const { client, calls } = await recordingClient(() => json(summary));
    await expect(client.getProgressionSummary()).resolves.toEqual(summary);
    expect(calls[0]?.url).toBe('https://api.runsphere.test/v1/progression');
  });

  // Fastify rejects an empty body under `content-type: application/json`, so a
  // body-less sync must still send an explicit JSON object.
  it('posts an explicit JSON object for the progression and achievement syncs', async () => {
    const { client, calls } = await recordingClient((call) =>
      call.url.endsWith('/v1/progression/sync')
        ? json({ status: 'synced', finalizedWeeks: 2 })
        : json({ status: 'synced', newlyAwarded: 1 })
    );
    await expect(client.syncProgression()).resolves.toEqual({
      status: 'synced',
      finalizedWeeks: 2
    });
    await expect(client.syncAchievements()).resolves.toEqual({
      status: 'synced',
      newlyAwarded: 1
    });
    expect(calls.map((call) => call.body)).toEqual(['{}', '{}']);
  });

  it('reports block and unblock outcomes from the server response', async () => {
    const { client, calls } = await recordingClient((call) =>
      json({ accountId: profile.id, status: call.method === 'POST' ? 'blocked' : 'unblocked' })
    );
    await expect(client.blockAccount({ accountId: profile.id })).resolves.toEqual({
      accountId: profile.id,
      status: 'blocked'
    });
    await expect(client.unblockAccount(profile.id)).resolves.toEqual({
      accountId: profile.id,
      status: 'unblocked'
    });
    expect(calls[1]?.method).toBe('DELETE');
    expect(calls[1]?.url).toBe(`https://api.runsphere.test/v1/blocks/${profile.id}`);
  });

  // Challenge routes arrive in milestone 2.5; until then the client must fail
  // loudly so no Play surface can present a challenge as live.
  it('fails with a typed 404 while the challenge routes are unimplemented', async () => {
    const { client } = await recordingClient(() => json({ message: 'Not Found' }, 404));
    await expect(
      client.createChallenge({
        friendAccountId: profile.id,
        mode: 'active_minutes',
        lengthDays: 7
      })
    ).rejects.toMatchObject({ name: 'ApiFailure', status: 404 });
  });
});

describe('mobile API body-less POST handling', () => {
  // Fastify answers 400 FST_ERR_CTP_EMPTY_JSON_BODY when `content-type` is
  // `application/json` and the body is empty, so every POST this client sends
  // must carry at least an empty JSON object.
  it('sends an explicit empty object for resend-verification and contact accept', async () => {
    const { client, calls } = await recordingClient((call) =>
      call.url.endsWith('/v1/account/email-verification')
        ? json({ status: 'requested' }, 202)
        : json({ status: 'accepted' })
    );
    await client.requestEmailVerification();
    await client.acceptSafetyContact('contact-1');
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['POST', 'https://api.runsphere.test/v1/account/email-verification', '{}'],
      ['POST', 'https://api.runsphere.test/v1/safety-contacts/contact-1/accept', '{}']
    ]);
  });
});
