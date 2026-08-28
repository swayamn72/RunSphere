import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlCipherDatabase } from './encrypted-sqlite.native.js';

const getItem = vi.fn<() => string | null>(() => null);
const setItem = vi.fn<(key: string, value: string) => void>();
vi.mock('expo-secure-store', () => ({ getItem, setItem }));

const cipherQueries: string[] = [];
const getFirstAsync: SqlCipherDatabase['getFirstAsync'] = async <T>(sql: string): Promise<T | null> => {
  cipherQueries.push(sql);
  return { cipher_version: '4.6.0' } as T;
};
const database: SqlCipherDatabase = {
  execAsync: vi.fn<(sql: string) => Promise<void>>(async () => undefined),
  getFirstAsync
};

describe('encrypted Expo SQLite setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    cipherQueries.length = 0;
  });

  it('sets a distinct SecureStore key before every database schema access', async () => {
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1');

    expect(setItem).toHaveBeenCalledWith(
      'runsphere.test.sqlcipher-key.v1',
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('PRAGMA key ='));
    expect(cipherQueries).toEqual(['PRAGMA cipher_version']);
  });
});
