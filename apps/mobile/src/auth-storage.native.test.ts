import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = {
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
};

vi.mock('expo-secure-store', () => secureStore);

describe('native auth storage adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loads the shared storage factory without resolving back to the native adapter', async () => {
    const { authStorage } = await import('./auth-storage.native.js');

    await expect(authStorage.read()).resolves.toBeUndefined();
    expect(secureStore.getItemAsync).toHaveBeenCalledTimes(3);
  });
});
