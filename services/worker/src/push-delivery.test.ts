import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';
import {
  createFcmSender,
  createPushDelivery,
  readFcmCredentials,
  signServiceAccountJwt,
  type FetchLike,
  type PushMessage,
  type PushSendResult
} from './push-delivery.js';

const logger = (): Logger => ({ info: vi.fn(), error: vi.fn() });

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

const credentials = {
  projectId: 'runsphere-test',
  clientEmail: 'push@runsphere-test.iam.gserviceaccount.com',
  privateKey
};

const response = (status: number, body = '{}') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
});

interface FakeRows {
  notification?: Record<string, unknown>[];
  dispatch?: Record<string, unknown>[];
  preferences?: Record<string, unknown>[];
  devices?: Record<string, unknown>[];
  sentToday?: number;
}

const fakeDatabase = (rows: FakeRows = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    statements.push({ sql, values });
    if (sql.includes('FROM notification_inbox'))
      return {
        rows: rows.notification ?? [
          {
            id: 'notification-1',
            account_id: 'account-1',
            kind: 'challenge_invite',
            deep_link: 'runsphere://play/challenges'
          }
        ]
      };
    if (sql.includes('SELECT notification_id FROM push_dispatches'))
      return { rows: rows.dispatch ?? [] };
    if (sql.includes('FROM notification_preferences')) return { rows: rows.preferences ?? [] };
    if (sql.includes('FROM push_devices'))
      return { rows: rows.devices ?? [{ id: 'device-1', token: 'token-1' }] };
    if (sql.includes('count(*)')) return { rows: [{ count: String(rows.sentToday ?? 0) }] };
    return { rows: [] };
  });
  return {
    statements,
    query,
    db: { query } as unknown as Database,
    sql: () => statements.map((statement) => statement.sql).join('\n')
  };
};

describe('FCM credentials', () => {
  it('requires every field before claiming the provider is configured', () => {
    expect(readFcmCredentials({})).toBeUndefined();
    expect(
      readFcmCredentials({ FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e@x', FCM_PRIVATE_KEY: '  ' })
    ).toBeUndefined();
  });

  it('restores newlines a private key picked up from environment escaping', () => {
    const parsed = readFcmCredentials({
      FCM_PROJECT_ID: 'p',
      FCM_CLIENT_EMAIL: 'e@x',
      FCM_PRIVATE_KEY: '-----BEGIN KEY-----\\nline\\n-----END KEY-----'
    });
    expect(parsed?.privateKey).toBe('-----BEGIN KEY-----\nline\n-----END KEY-----');
  });
});

describe('service-account assertion', () => {
  it('signs a scoped, audience-bound JWT the token endpoint will accept', () => {
    const [header, claims, signature] = signServiceAccountJwt(credentials, 1_000).split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT'
    });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      iss: credentials.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_000,
      exp: 4_600
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('FCM sender', () => {
  const senderWith = (handler: FetchLike) =>
    createFcmSender(credentials, {
      fetchImpl: handler,
      now: () => new Date('2026-09-04T09:00:00.000Z')
    });

  it('sends a data-only message carrying no title, body, or score', async () => {
    const calls: { url: string; body: string }[] = [];
    const send = senderWith(async (url, init) => {
      calls.push({ url, body: init.body });
      return url.includes('oauth2')
        ? response(200, JSON.stringify({ access_token: 'access-1', expires_in: 3600 }))
        : response(200);
    });

    await expect(
      send({ token: 'device-token', notificationId: 'n-1', deepLink: 'runsphere://play' })
    ).resolves.toBe('sent');

    const message = JSON.parse(calls[1]!.body) as {
      message: Record<string, unknown> & { data: Record<string, string> };
    };
    expect(calls[1]!.url).toContain('/v1/projects/runsphere-test/messages:send');
    expect(message.message.data).toEqual({
      notificationId: 'n-1',
      deepLink: 'runsphere://play'
    });
    expect(message.message).not.toHaveProperty('notification');
    expect(calls[1]!.body).not.toContain('title');
  });

  it('reuses one access token across sends and only exchanges once', async () => {
    let exchanges = 0;
    const send = senderWith(async (url) => {
      if (url.includes('oauth2')) {
        exchanges += 1;
        return response(200, JSON.stringify({ access_token: 'access-1', expires_in: 3600 }));
      }
      return response(200);
    });

    await send({ token: 'a', notificationId: 'n-1' });
    await send({ token: 'b', notificationId: 'n-2' });
    expect(exchanges).toBe(1);
  });

  it('reports a dead address separately from a transient failure', async () => {
    const results: PushSendResult[] = [];
    for (const [status, body] of [
      [404, '{}'],
      [400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } })],
      [400, JSON.stringify({ error: { status: 'QUOTA_EXCEEDED' } })],
      [503, '{}']
    ] as [number, string][]) {
      const send = senderWith(async (url) =>
        url.includes('oauth2')
          ? response(200, JSON.stringify({ access_token: 'access-1', expires_in: 3600 }))
          : response(status, body)
      );
      results.push(await send({ token: 'a', notificationId: 'n-1' }));
    }
    expect(results).toEqual(['unregistered', 'unregistered', 'failed', 'failed']);
  });

  it('surfaces a token exchange failure rather than reporting a send', async () => {
    const send = senderWith(async () => response(401, 'denied'));
    await expect(send({ token: 'a', notificationId: 'n-1' })).rejects.toThrow(
      'push token exchange failed with status 401'
    );
  });
});

describe('push delivery handler', () => {
  const sent = vi.fn(async (): Promise<PushSendResult> => 'sent');

  it('leaves transactional email explicitly deferred', async () => {
    const database = fakeDatabase();
    const log = logger();
    await createPushDelivery({ db: database.db, sender: sent, logger: log })(
      'email.transactional',
      'email-1',
      {}
    );
    expect(database.query).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('delivery.deferred', { topic: 'email.transactional' });
  });

  it('no-ops without provider credentials instead of failing the event', async () => {
    const database = fakeDatabase();
    const log = logger();
    await createPushDelivery({ db: database.db, logger: log })(
      'notification.created',
      'notification-1',
      {}
    );
    expect(database.query).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('push.provider_unconfigured', {
      topic: 'notification.created'
    });
  });

  it('sends the notification id and deep link, and nothing else, to each device', async () => {
    const database = fakeDatabase({
      devices: [
        { id: 'device-1', token: 'token-1' },
        { id: 'device-2', token: 'token-2' }
      ]
    });
    const sender = vi.fn(async (_message: PushMessage): Promise<PushSendResult> => 'sent');
    await createPushDelivery({ db: database.db, sender, logger: logger() })(
      'notification.created',
      'notification-1',
      {}
    );
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0]![0]).toEqual({
      token: 'token-1',
      notificationId: 'notification-1',
      deepLink: 'runsphere://play/challenges'
    });
    const dispatch = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO push_dispatches')
    );
    expect(dispatch?.values).toEqual(['notification-1', 'account-1', 'sent', 'ok', 2]);
  });

  it('does not push a second time for a notification already dispatched', async () => {
    const database = fakeDatabase({ dispatch: [{ notification_id: 'notification-1' }] });
    const sender = vi.fn(async (): Promise<PushSendResult> => 'sent');
    await createPushDelivery({ db: database.db, sender, logger: logger() })(
      'notification.created',
      'notification-1',
      {}
    );
    expect(sender).not.toHaveBeenCalled();
    expect(database.sql()).not.toContain('INSERT INTO push_dispatches');
  });

  it('skips a notification an account erasure already removed', async () => {
    const database = fakeDatabase({ notification: [] });
    const sender = vi.fn(async (): Promise<PushSendResult> => 'sent');
    await createPushDelivery({ db: database.db, sender, logger: logger() })(
      'notification.created',
      'gone',
      {}
    );
    expect(sender).not.toHaveBeenCalled();
    expect(database.sql()).not.toContain('INSERT INTO push_dispatches');
  });

  it('records a suppression with its reason when the category is switched off', async () => {
    const database = fakeDatabase({
      preferences: [
        {
          categories: {
            friends: true,
            challenges: false,
            clubs: true,
            competitions: true,
            account: true,
            marketing: false
          },
          quiet_hours: null,
          max_per_day: 50,
          channels: { push: true, email: false }
        }
      ]
    });
    const sender = vi.fn(async (): Promise<PushSendResult> => 'sent');
    const log = logger();
    await createPushDelivery({ db: database.db, sender, logger: log })(
      'notification.created',
      'notification-1',
      {}
    );
    expect(sender).not.toHaveBeenCalled();
    const dispatch = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO push_dispatches')
    );
    expect(dispatch?.values).toEqual([
      'notification-1',
      'account-1',
      'suppressed',
      'category_off',
      0
    ]);
    expect(log.info).toHaveBeenCalledWith('push.suppressed', {
      notificationId: 'notification-1',
      reason: 'category_off'
    });
  });

  it('suppresses once the account has reached its own daily cap', async () => {
    const database = fakeDatabase({
      preferences: [
        {
          categories: {
            friends: true,
            challenges: true,
            clubs: true,
            competitions: true,
            account: true,
            marketing: false
          },
          quiet_hours: null,
          max_per_day: 3,
          channels: { push: true, email: false }
        }
      ],
      sentToday: 3
    });
    const sender = vi.fn(async (): Promise<PushSendResult> => 'sent');
    await createPushDelivery({ db: database.db, sender, logger: logger() })(
      'notification.created',
      'notification-1',
      {}
    );
    expect(sender).not.toHaveBeenCalled();
    const dispatch = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO push_dispatches')
    );
    expect(dispatch?.values.slice(2)).toEqual(['suppressed', 'daily_cap', 0]);
  });

  it('revokes a dead address and records the notification as undeliverable', async () => {
    const database = fakeDatabase();
    const sender = vi.fn(async (): Promise<PushSendResult> => 'unregistered');
    await createPushDelivery({ db: database.db, sender, logger: logger() })(
      'notification.created',
      'notification-1',
      {}
    );
    const revoke = database.statements.find((statement) =>
      statement.sql.includes('UPDATE push_devices SET revoked_at')
    );
    expect(revoke?.sql).toContain("revoke_reason = 'provider_unregistered'");
    expect(revoke?.values).toEqual(['device-1']);
    const dispatch = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO push_dispatches')
    );
    expect(dispatch?.values.slice(2)).toEqual(['suppressed', 'no_devices', 0]);
  });

  it('throws on a transient failure so the outbox retries, writing no dispatch row', async () => {
    const database = fakeDatabase();
    const sender = vi.fn(async (): Promise<PushSendResult> => 'failed');
    await expect(
      createPushDelivery({ db: database.db, sender, logger: logger() })(
        'notification.created',
        'notification-1',
        {}
      )
    ).rejects.toThrow('push delivery failed for 1 device(s)');
    expect(database.sql()).not.toContain('INSERT INTO push_dispatches');
  });

  it('counts the cap window from the account zone when quiet hours declare one', async () => {
    const database = fakeDatabase({
      preferences: [
        {
          categories: {
            friends: true,
            challenges: true,
            clubs: true,
            competitions: true,
            account: true,
            marketing: false
          },
          quiet_hours: { start: '22:00', end: '07:00', timezone: 'UTC' },
          max_per_day: 50,
          channels: { push: true, email: false }
        }
      ]
    });
    await createPushDelivery({
      db: database.db,
      sender: sent,
      logger: logger(),
      now: () => new Date('2026-09-04T09:00:00.000Z')
    })('notification.created', 'notification-1', {});
    const counted = database.statements.find((statement) => statement.sql.includes('count(*)'));
    expect(counted?.values[1]).toBe('2026-09-04T00:00:00.000Z');
  });

  it('holds a push inside the account quiet hours without touching the inbox row', async () => {
    const database = fakeDatabase({
      preferences: [
        {
          categories: {
            friends: true,
            challenges: true,
            clubs: true,
            competitions: true,
            account: true,
            marketing: false
          },
          quiet_hours: { start: '22:00', end: '07:00', timezone: 'UTC' },
          max_per_day: 50,
          channels: { push: true, email: false }
        }
      ]
    });
    const sender = vi.fn(async (): Promise<PushSendResult> => 'sent');
    await createPushDelivery({
      db: database.db,
      sender,
      logger: logger(),
      now: () => new Date('2026-09-04T23:30:00.000Z')
    })('notification.created', 'notification-1', {});
    expect(sender).not.toHaveBeenCalled();
    expect(database.sql()).not.toContain('UPDATE notification_inbox');
    const dispatch = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO push_dispatches')
    );
    expect(dispatch?.values.slice(2)).toEqual(['suppressed', 'quiet_hours', 0]);
  });
});
