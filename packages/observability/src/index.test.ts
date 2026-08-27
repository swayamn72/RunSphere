import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './index.js';

describe('createLogger', () => {
  it('emits a structured event with level and service fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    createLogger('worker').info('worker.started', { jobCount: 0 });
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({
      level: 'info',
      service: 'worker',
      event: 'worker.started',
      jobCount: 0
    });
    info.mockRestore();
  });
});
