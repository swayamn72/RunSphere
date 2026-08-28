import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';
import {
  convergeAccountDeletion,
  processMaintenance,
  processNextDelivery,
  purgeExpiredRawTraces,
  startWorker
} from './worker.js';

type MockQuery = (sql: string, values?: readonly unknown[]) => Promise<{ rows: { id: string }[] }>;

const transactionDatabase = () => {
  const query = vi.fn<MockQuery>(async () => ({ rows: [] }));
  const clientQuery = vi.fn<MockQuery>(async () => ({ rows: [] }));
  const client = { query: clientQuery, release: vi.fn() };
  return {
    query,
    clientQuery,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined)
  };
};

describe('privacy maintenance', () => {
  it('purges every expired raw trace, including empty traces', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'activity-id' }] });
    await expect(purgeExpiredRawTraces({ query } as never)).resolves.toBe(1);
    expect(query.mock.calls[0]![0]).toContain('raw_trace_retention_until <= now()');
    expect(query.mock.calls[0]![0]).toContain('UPDATE raw_trace_objects SET purged_at = now()');
    expect(query.mock.calls[0]![0]).toContain('UPDATE activity_submissions');
  });

  it('converges each account deletion in one transaction', async () => {
    const database = transactionDatabase();
    database.query.mockResolvedValueOnce({ rows: [{ id: 'account-id' }] });
    database.clientQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id FROM accounts') ? { rows: [{ id: 'account-id' }] } : { rows: [] }
    );

    await expect(convergeAccountDeletion(database as unknown as Database)).resolves.toBe(1);

    expect(database.clientQuery.mock.calls[1]![0]).toContain('FOR UPDATE');
    expect(database.clientQuery.mock.calls.map(([sql]) => sql).join('\n')).toContain(
      'account_deletion_tombstones'
    );
    expect(database.clientQuery.mock.calls.map(([sql]) => sql).join('\n')).toContain(
      'DELETE FROM accounts'
    );
    expect(database.clientQuery.mock.calls[0]![0]).toBe('BEGIN');
    expect(database.clientQuery.mock.calls.at(-1)![0]).toBe('COMMIT');
  });

  it('rolls back an account deletion when one cleanup operation fails', async () => {
    const database = transactionDatabase();
    database.query.mockResolvedValueOnce({ rows: [{ id: 'account-id' }] });
    database.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM accounts')) return { rows: [{ id: 'account-id' }] };
      if (sql.includes('account_deletion_tombstones')) throw new Error('storage unavailable');
      return { rows: [] };
    });

    await expect(convergeAccountDeletion(database as unknown as Database)).rejects.toThrow(
      'storage unavailable'
    );
    expect(database.clientQuery.mock.calls.at(-1)![0]).toBe('ROLLBACK');
  });

  it('runs competing maintenance jobs sequentially', async () => {
    const calls: string[] = [];
    const database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('raw_trace_retention_until')) {
          calls.push('purge:start');
          await Promise.resolve();
          calls.push('purge:end');
          return { rows: [{ id: 'activity-id' }] };
        }
        if (sql.includes('deletion_requested_at')) {
          calls.push('delete');
          return { rows: [] };
        }
        calls.push('expire');
        return { rows: [] };
      })
    };
    await expect(processMaintenance(database as never)).resolves.toBe(1);
    expect(calls).toEqual(['purge:start', 'purge:end', 'delete', 'expire']);
  });
});

describe('processNextDelivery', () => {
  it('claims and completes a fan-out event through the injected delivery handler', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'event-id',
          topic: 'notification.created',
          aggregate_id: 'notification-id',
          payload: { kind: 'friend_request' }
        }
      ]
    });
    const delivered: Array<{ topic: string; aggregateId: string; payload: unknown }> = [];
    const db = { query } as never;

    const handled = await processNextDelivery(db, async (topic, aggregateId, payload) => {
      delivered.push({ topic, aggregateId, payload });
    });

    expect(handled).toBe(true);
    expect(delivered).toEqual([
      {
        topic: 'notification.created',
        aggregateId: 'notification-id',
        payload: { kind: 'friend_request' }
      }
    ]);
    expect(query.mock.calls[0]![0]).toContain('topic = ANY($1::text[])');
    expect(query.mock.calls[1]![0]).toContain('SET processed_at = now()');
  });

  it('returns false when no fan-out event is pending', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(processNextDelivery({ query } as never)).resolves.toBe(false);
  });

  it('records a failure without marking the event processed', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'event-id',
          topic: 'email.transactional',
          aggregate_id: 'request-id',
          payload: { kind: 'deletion_verify' }
        }
      ]
    });
    const db = { query } as never;

    await expect(
      processNextDelivery(db, async () => {
        throw new Error('provider unavailable');
      })
    ).resolves.toBe(true);

    expect(query.mock.calls[1]![0]).toContain('last_error = $2');
    expect(query.mock.calls[1]![0]).toContain('failed_at = CASE');
  });
});

describe('worker startup', () => {
  it('reports a ready worker with an empty m0 job queue', () => {
    const logger: Logger = { info: vi.fn(), error: vi.fn() };
    expect(startWorker(logger)).toEqual({ service: 'worker', status: 'ready', queuedJobs: 0 });
    expect(logger.info).toHaveBeenCalledWith('worker.started', {
      service: 'worker',
      status: 'ready',
      queuedJobs: 0
    });
  });
});
