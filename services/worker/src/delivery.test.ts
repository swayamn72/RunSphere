import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { createConfiguredDelivery, createDelivery } from './delivery.js';

/**
 * Topic routing.
 *
 * The property worth protecting is the one the old push-only handler had by
 * accident: **an unconfigured provider drops its events with a log line rather
 * than failing them.** A topic that threw would burn the outbox attempt budget
 * and mark deliverable mail permanently dead, and there is no way back from
 * `failed_at` without a manual query.
 */
const logger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn()
});

const fakeDatabase = () => {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    return { rows: [] };
  });
  return {
    statements,
    sql: () => statements.join('\n'),
    db: { query, connect: vi.fn(), end: vi.fn() } as unknown as Database
  };
};

describe('routing an outbox topic', () => {
  it('does not throw for any topic when nothing is configured', async () => {
    const database = fakeDatabase();
    const deliver = createDelivery({ db: database.db, logger: logger() });

    for (const topic of ['notification.created', 'email.transactional', 'email.campaign']) {
      await expect(deliver(topic, 'agg-1', { kind: 'password_reset' })).resolves.toBeUndefined();
    }
  });

  it('sends a notification to the push handler', async () => {
    const database = fakeDatabase();
    const log = logger();
    const deliver = createDelivery({ db: database.db, logger: log });

    await deliver('notification.created', 'notification-1', {});

    expect(log.info).toHaveBeenCalledWith('push.provider_unconfigured', {
      topic: 'notification.created'
    });
  });

  it('sends a transactional event to the email handler', async () => {
    const database = fakeDatabase();
    const log = logger();
    const deliver = createDelivery({ db: database.db, logger: log });

    await deliver('email.transactional', 'agg-1', { kind: 'password_reset' });

    expect(log.info).toHaveBeenCalledWith('email.provider_absent', { kind: 'password_reset' });
  });

  it('sends a campaign event to the campaign handler', async () => {
    const database = fakeDatabase();
    const log = logger();
    const deliver = createDelivery({ db: database.db, logger: log });

    await deliver('email.campaign', 'campaign-1', {});

    expect(log.info).toHaveBeenCalledWith('email.provider_absent', { campaignId: 'campaign-1' });
  });

  it('still defers a topic nothing carries', async () => {
    const database = fakeDatabase();
    const log = logger();
    const deliver = createDelivery({ db: database.db, logger: log });

    await deliver('something.invented', 'agg-1', {});

    expect(log.info).toHaveBeenCalledWith('delivery.deferred', { topic: 'something.invented' });
  });
});

describe('reading the configuration', () => {
  it('says which providers are configured, so silence is not the only signal', () => {
    // "No push arrived" and "no push provider is configured" look identical
    // from the outside, and the second is a deployment mistake somebody can fix
    // in a minute.
    const database = fakeDatabase();
    const log = logger();

    createConfiguredDelivery(database.db, log, {});

    expect(log.info).toHaveBeenCalledWith('worker.delivery_providers', {
      push: false,
      email: false
    });
  });

  it('reports both as configured when both are fully set', () => {
    const database = fakeDatabase();
    const log = logger();

    createConfiguredDelivery(database.db, log, {
      FCM_PROJECT_ID: 'project',
      FCM_CLIENT_EMAIL: 'sender@project.iam.gserviceaccount.com',
      FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----',
      EMAIL_API_URL: 'https://provider.test/send',
      EMAIL_API_KEY: 'key',
      EMAIL_FROM: 'no-reply@runsphere.test',
      APP_BASE_URL: 'https://runsphere.test'
    });

    expect(log.info).toHaveBeenCalledWith('worker.delivery_providers', {
      push: true,
      email: true
    });
  });

  it('reports one configured and one not, independently', () => {
    const database = fakeDatabase();
    const log = logger();

    createConfiguredDelivery(database.db, log, {
      EMAIL_API_URL: 'https://provider.test/send',
      EMAIL_API_KEY: 'key',
      EMAIL_FROM: 'no-reply@runsphere.test',
      APP_BASE_URL: 'https://runsphere.test'
    });

    expect(log.info).toHaveBeenCalledWith('worker.delivery_providers', {
      push: false,
      email: true
    });
  });
});
