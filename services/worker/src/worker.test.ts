import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';
import {
  convergeAccountDeletion,
  expireSanctions,
  processMaintenance,
  processNextChallengeFinish,
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

  it('archives a club the erased account owned, so it is not left ownerless', async () => {
    const database = transactionDatabase();
    database.query.mockResolvedValueOnce({ rows: [{ id: 'account-id' }] });
    database.clientQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id FROM accounts') ? { rows: [{ id: 'account-id' }] } : { rows: [] }
    );

    await convergeAccountDeletion(database as unknown as Database);

    const archive = database.clientQuery.mock.calls.find(([sql]) =>
      sql.includes('UPDATE clubs SET archived_at')
    );
    expect(archive?.[0]).toContain("role = 'owner'");
    expect(archive?.[1]).toEqual(['account-id']);
    // Ordering matters: the club must be archived while the membership row
    // that proves ownership still exists.
    const statements = database.clientQuery.mock.calls.map(([sql]) => sql);
    expect(
      statements.findIndex((sql) => sql.includes('UPDATE clubs SET archived_at'))
    ).toBeLessThan(statements.findIndex((sql) => sql.includes('DELETE FROM accounts')));
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
        if (sql.includes('invite_expires_at')) {
          calls.push('lapsed-invites');
          return { rows: [] };
        }
        if (sql.includes('outbox_events')) {
          calls.push('due-challenges');
          return { rows: [] };
        }
        if (sql.includes("kind = 'club'")) {
          calls.push('relay-rule');
          return { rows: [] };
        }
        if (sql.includes('FROM club_challenges challenge')) {
          calls.push('club-challenges');
          return { rows: [] };
        }
        if (sql.includes("kind = 'global_board'")) {
          calls.push('global-board-rule');
          return { rows: [] };
        }
        if (sql.includes('FROM competitions')) {
          calls.push('competitions');
          return { rows: [] };
        }
        if (sql.includes('UPDATE sanctions SET')) {
          calls.push('sanctions');
          return { rows: [] };
        }
        if (sql.includes('FROM email_campaigns')) {
          calls.push('campaigns');
          return { rows: [] };
        }
        calls.push('expire');
        return { rows: [] };
      })
    };
    await expect(processMaintenance(database as never)).resolves.toBe(1);
    // Account erasure must settle before a closed challenge window is queued,
    // so an erased participant is never scored. Relay totals are a recompute
    // and run last, so they already reflect this sweep's departures; club
    // challenges are finished after all of it for the same reason, and the
    // global board — a full recompute over the widest set of accounts — is
    // last of all.
    expect(calls).toEqual([
      'purge:start',
      'purge:end',
      'delete',
      'expire',
      'lapsed-invites',
      'due-challenges',
      'relay-rule',
      'club-challenges',
      'global-board-rule',
      'competitions',
      'sanctions',
      'campaigns'
    ]);
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

describe('processNextChallengeFinish', () => {
  it('claims a closed challenge window, scores it, and marks the event processed', async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.includes('UPDATE outbox_events SET claimed_at'))
        return { rows: [{ id: 'event-id', aggregate_id: 'challenge-id' }] };
      // No such active challenge, so scoring is a no-op the loop still completes.
      return { rows: [] };
    });

    await expect(processNextChallengeFinish({ query } as never)).resolves.toBe(true);

    expect(query.mock.calls[0]![0]).toContain('topic = $1');
    expect(query.mock.calls[0]![1]).toContain('challenge.finished');
    expect(query.mock.calls[0]![0]).toContain('SKIP LOCKED');
    expect(query.mock.calls.at(-1)![0]).toContain('SET processed_at = now()');
  });

  it('returns false when no challenge window is waiting to be scored', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(processNextChallengeFinish({ query } as never)).resolves.toBe(false);
  });

  it('records a scoring failure without marking the event processed', async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.includes('UPDATE outbox_events SET claimed_at'))
        return { rows: [{ id: 'event-id', aggregate_id: 'challenge-id' }] };
      if (sql.includes('FROM challenges WHERE id'))
        return {
          rows: [
            {
              id: 'challenge-id',
              mode: 'active_minutes',
              length_days: 3,
              rule_version: '1',
              period_start: '2026-08-31',
              challenger_account_id: 'a',
              opponent_account_id: 'b'
            }
          ]
        };
      // The agreed rule version is unreadable, so scoring must not invent a tie.
      return { rows: [] };
    });

    await expect(processNextChallengeFinish({ query } as never)).resolves.toBe(true);

    const last = query.mock.calls.at(-1)!;
    expect(last[0]).toContain('last_error = $2');
    expect(last[0]).toContain('failed_at = CASE');
    expect(last[0]).not.toContain('SET processed_at = now()');
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

describe('expiring sanctions', () => {
  it('closes out only sanctions the clock has ended, and records why', async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ id: 'sanction-1' }, { id: 'sanction-2' }]
    }));

    await expect(expireSanctions({ query } as unknown as Database)).resolves.toBe(2);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("revoked_reason = 'expired'");
    // A live sanction, an indefinite one, and one already revoked are all left
    // alone; a warning has no expiry, so it is never touched here.
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at IS NOT NULL');
    expect(sql).toContain('expires_at <= now()');
  });

  it('ends a sanction at its stated time rather than at sweep time', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] }));
    await expireSanctions({ query } as unknown as Database);

    // The account was free from the moment the sanction expired, not from
    // whenever the worker happened to notice.
    expect(query.mock.calls[0]![0]).toContain('revoked_at = expires_at');
  });
});
