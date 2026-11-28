import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileResource } from './profile-cache';

afterEach(() => vi.useRealTimers());

describe('profile resource', () => {
  it('shares an in-flight load and keeps data visible while refreshing an expired entry', async () => {
    vi.useFakeTimers();
    const fetchValue = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('updated');
    const resource = profileResource<string>(fetchValue);

    const first = resource.load();
    expect(resource.load()).toBe(first);
    await expect(first).resolves.toBe('first');
    await expect(resource.load()).resolves.toBe('first');
    expect(fetchValue).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    const refresh = resource.load();
    expect(resource.peek()).toBe('first');
    await expect(refresh).resolves.toBe('updated');
    expect(resource.peek()).toBe('updated');
    expect(fetchValue).toHaveBeenCalledTimes(2);
  });

  it('keeps a saved edit when a previous request finishes later', async () => {
    const resource = profileResource(async () => 'old');
    const previous = resource.load();
    resource.write('edited');
    await expect(previous).resolves.toBe('edited');
    expect(resource.peek()).toBe('edited');
  });
});
