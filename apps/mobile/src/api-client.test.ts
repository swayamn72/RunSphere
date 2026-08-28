import { describe, expect, it } from 'vitest';
import { MobileApiClient } from './api-client.js';
import { createAuthStorage, type SecureKeyValueStore } from './auth-storage-core.js';

class MemorySecureStore implements SecureKeyValueStore {
  private readonly values = new Map<string, string>();
  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresInSeconds: 900
};

describe('mobile API auth client', () => {
  it('registers and persists the returned bearer and refresh tokens', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    const fetcher = async () => new Response(JSON.stringify(session), { status: 201 });
    const client = new MobileApiClient('https://api.runsphere.test', fetcher, storage);
    await expect(
      client.register({
        email: 'maya@example.com',
        password: 'long-enough-password',
        ageAssertion: true,
        policyVersion: 'm1'
      })
    ).resolves.toEqual(session);
    await expect(storage.read()).resolves.toEqual(session);
  });

  it('does not clear secure storage until account-scoped cleanup runs', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    await storage.save(session);
    const client = new MobileApiClient(
      'https://api.runsphere.test',
      async () => new Response(null, { status: 204 }),
      storage
    );
    await client.logout();
    await expect(storage.read()).resolves.toEqual(session);
  });

  it('rotates persisted tokens through the refresh endpoint', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    await storage.save(session);
    const rotated = { ...session, accessToken: 'rotated-access', refreshToken: 'rotated-refresh' };
    const client = new MobileApiClient(
      'https://api.runsphere.test',
      async () => new Response(JSON.stringify(rotated)),
      storage
    );
    await expect(client.refresh()).resolves.toEqual(rotated);
    await expect(storage.read()).resolves.toEqual(rotated);
  });
});
