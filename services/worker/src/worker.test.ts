import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@runsphere/observability';
import { startWorker } from './worker.js';

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
