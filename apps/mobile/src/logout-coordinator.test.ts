import { describe, expect, it, vi } from 'vitest';
import { coordinateLogout } from './logout-coordinator.js';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('logout coordinator', () => {
  it('attempts remote logout before clearing auth and the account queue', async () => {
    const calls: string[] = [];
    await coordinateLogout({
      api: { logout: vi.fn(async () => void calls.push('remote')) },
      auth: { clear: vi.fn(async () => void calls.push('auth')) },
      queue: { clear: vi.fn(async () => void calls.push('queue')) }
    });

    expect(calls[0]).toBe('remote');
    expect(calls.slice(1).sort()).toEqual(['auth', 'queue']);
  });

  it('revokes the push address while the session can still authenticate it', async () => {
    const calls: string[] = [];
    await coordinateLogout({
      api: { logout: vi.fn(async () => void calls.push('remote')) },
      auth: { clear: vi.fn(async () => void calls.push('auth')) },
      queue: { clear: vi.fn(async () => void calls.push('queue')) },
      push: { revoke: vi.fn(async () => void calls.push('push')) }
    });

    expect(calls[0]).toBe('push');
    expect(calls[1]).toBe('remote');
  });

  it('still clears local account data when remote logout fails', async () => {
    const auth = { clear: vi.fn().mockResolvedValue(undefined) };
    const queue = { clear: vi.fn().mockResolvedValue(undefined) };

    await expect(
      coordinateLogout({
        api: { logout: vi.fn().mockRejectedValue(new Error('network unavailable')) },
        auth,
        queue
      })
    ).resolves.toBeUndefined();
    expect(auth.clear).toHaveBeenCalledOnce();
    expect(queue.clear).toHaveBeenCalledOnce();
  });

  it('does not finish until both auth and queue cleanup complete', async () => {
    const authCleanup = deferred<void>();
    const queueCleanup = deferred<void>();
    let finished = false;

    const logout = coordinateLogout({
      api: { logout: vi.fn().mockResolvedValue(undefined) },
      auth: { clear: vi.fn(() => authCleanup.promise) },
      queue: { clear: vi.fn(() => queueCleanup.promise) }
    }).then(() => {
      finished = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    authCleanup.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    queueCleanup.resolve();
    await logout;
    expect(finished).toBe(true);
  });
});
