import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlCipherDatabase } from './encrypted-sqlite.native.js';

const getItem = vi.fn<() => string | null>(() => null);
const setItem = vi.fn<(key: string, value: string) => void>();
vi.mock('expo-secure-store', () => ({ getItem, setItem }));

const cipherQueries: string[] = [];
const getFirstAsync: SqlCipherDatabase['getFirstAsync'] = async <T>(sql: string): Promise<T | null> => {
  cipherQueries.push(sql);
  if (sql === 'PRAGMA cipher_version') return { cipher_version: '4.6.0' } as T;
  return null;
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
    getItem.mockReturnValue(null);
  });

  it('migrates an existing plaintext database in place before storing its new key', async () => {
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1');

    expect(database.execAsync).toHaveBeenNthCalledWith(1, "PRAGMA key = '';");
    expect(cipherQueries).toEqual([
      "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1",
      'PRAGMA cipher_version'
    ]);
    expect(database.execAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^PRAGMA rekey = '[a-f0-9]{64}';$/)
    );
    expect(setItem).toHaveBeenCalledWith(
      'runsphere.test.sqlcipher-key.v1',
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it('preserves an unrecoverable existing database instead of overwriting queued runs', async () => {
    const unreadableDatabase: SqlCipherDatabase = {
      execAsync: vi.fn(async () => undefined),
      getFirstAsync: async () => {
        throw new Error('file is encrypted or is not a database');
      }
    };
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');

    await expect(
      prepareEncryptedDatabase(unreadableDatabase, 'runsphere.test.sqlcipher-key.v1')
    ).rejects.toThrow('cannot be recovered');
    expect(unreadableDatabase.execAsync).not.toHaveBeenCalledWith(expect.stringContaining('PRAGMA rekey'));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('opens an already encrypted database with its Keystore-backed key', async () => {
    getItem.mockReturnValue('a'.repeat(64));
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1');

    expect(database.execAsync).toHaveBeenCalledWith(`PRAGMA key = '${'a'.repeat(64)}';`);
    expect(database.execAsync).not.toHaveBeenCalledWith(expect.stringContaining('PRAGMA rekey'));
    expect(cipherQueries).toEqual(['PRAGMA cipher_version']);
    expect(setItem).not.toHaveBeenCalled();
  });
});
