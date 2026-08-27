import { describe, expect, it } from 'vitest';
import { createAuthStorage, type SecureKeyValueStore } from './auth-storage.js';

class MemorySecureStore implements SecureKeyValueStore {
  readonly values = new Map<string, string>();
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

describe('auth storage', () => {
  it('stores bearer and rotating refresh tokens separately, then clears both', async () => {
    const storage = createAuthStorage(new MemorySecureStore());
    const session = {
      accessToken: 'bearer-token',
      refreshToken: 'rotating-refresh-token',
      expiresInSeconds: 900
    };
    await storage.save(session);
    await expect(storage.read()).resolves.toEqual(session);
    await storage.clear();
    await expect(storage.read()).resolves.toBeUndefined();
  });
});
