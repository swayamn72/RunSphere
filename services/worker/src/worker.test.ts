import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@runsphere/observability';
import { convergeAccountDeletion, purgeExpiredRawTraces, startWorker } from './worker.js';

describe('privacy maintenance', () => {
  it('purges every expired raw trace, including empty traces', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'activity-id' }] });
    await expect(purgeExpiredRawTraces({ query } as never)).resolves.toBe(1);
    expect(query.mock.calls[0]![0]).toContain('raw_trace_retention_until <= now()');
    expect(query.mock.calls[0]![0]).toContain('UPDATE activity_submissions');
  });

  it('converges deletion to a minimal account tombstone', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'account-id' }] })
      .mockResolvedValue({ rows: [] });
    await expect(convergeAccountDeletion({ query } as never)).resolves.toBe(1);
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).toContain(
      'account_deletion_tombstones'
    );
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).toContain('DELETE FROM accounts');
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
