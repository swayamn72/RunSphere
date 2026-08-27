import { describe, expect, it, vi } from 'vitest';
import { clearAccountData } from './account-cleanup.js';

describe('account cleanup', () => {
  it('wipes the queue and secure tokens for logout or deletion', async () => {
    const queue = { clear: vi.fn().mockResolvedValue(undefined) };
    const auth = { clear: vi.fn().mockResolvedValue(undefined) };
    await clearAccountData(queue, auth);
    expect(queue.clear).toHaveBeenCalledOnce();
    expect(auth.clear).toHaveBeenCalledOnce();
  });
});
