import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItem = vi.fn(() => null);
const setItem = vi.fn();
vi.mock('expo-secure-store', () => ({ getItem, setItem }));

const database = {
  execAsync: vi.fn(async () => undefined),
  getFirstAsync: vi.fn(async () => ({ cipher_version: '4.6.0' }))
};

describe('encrypted Expo SQLite setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('sets a distinct SecureStore key before every database schema access', async () => {
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1');

    expect(setItem).toHaveBeenCalledWith(
      'runsphere.test.sqlcipher-key.v1',
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('PRAGMA key ='));
    expect(database.getFirstAsync).toHaveBeenCalledWith('PRAGMA cipher_version');
  });
});
