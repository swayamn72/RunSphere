import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlCipherDatabase } from './encrypted-sqlite.native.js';

const randomBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
const getRandomBytesAsync = vi.fn<(byteCount: number) => Promise<Uint8Array>>(
  async () => randomBytes
);
const getItemAsync = vi.fn<() => Promise<string | null>>(async () => null);
const setItemAsync = vi.fn<(key: string, value: string) => Promise<void>>(async () => undefined);
vi.mock('expo-crypto', () => ({ getRandomBytesAsync }));
vi.mock('expo-secure-store', () => ({ getItemAsync, setItemAsync }));

const generatedKey = Array.from(randomBytes, (value) => value.toString(16).padStart(2, '0')).join(
  ''
);

const cipherQueries: string[] = [];
const getFirstAsync: SqlCipherDatabase['getFirstAsync'] = async <T>(
  sql: string
): Promise<T | null> => {
  cipherQueries.push(sql);
  if (sql === 'PRAGMA cipher_version') return { cipher_version: '4.7.0' } as T;
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
    getRandomBytesAsync.mockResolvedValue(randomBytes);
    getItemAsync.mockResolvedValue(null);
    setItemAsync.mockResolvedValue(undefined);
  });

  it('provisions and persists a fresh-install key before opening the database', async () => {
    const events: string[] = [];
    getItemAsync.mockImplementation(async () => {
      events.push('read-key');
      return null;
    });
    setItemAsync.mockImplementation(async () => {
      events.push('store-key');
    });
    const freshDatabase: SqlCipherDatabase = {
      execAsync: vi.fn(async (sql: string) => {
        events.push(sql);
      }),
      getFirstAsync: async <T>(sql: string) => {
        events.push(sql);
        if (sql === 'PRAGMA cipher_version') return { cipher_version: '4.7.0' } as T;
        return null;
      }
    };

    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(freshDatabase, 'runsphere.test.sqlcipher-key.v1');

    expect(events).toEqual([
      'read-key',
      'store-key',
      `PRAGMA key = '${generatedKey}';`,
      'PRAGMA cipher_version',
      "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1"
    ]);
    expect(getRandomBytesAsync).toHaveBeenCalledWith(32);
    expect(setItemAsync).toHaveBeenCalledWith('runsphere.test.sqlcipher-key.v1', generatedKey);
    expect(freshDatabase.execAsync).not.toHaveBeenCalledWith(expect.stringContaining("key = ''"));
    expect(freshDatabase.execAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('PRAGMA rekey')
    );
  });

  it.each(['', '   '])(
    'fails closed when SecureStore returns an empty key (%j)',
    async (emptyKey) => {
      getItemAsync.mockResolvedValue(emptyKey);
      const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');

      await expect(
        prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1')
      ).rejects.toThrow('encryption key is empty');
      expect(database.execAsync).not.toHaveBeenCalled();
      expect(getRandomBytesAsync).not.toHaveBeenCalled();
      expect(setItemAsync).not.toHaveBeenCalled();
    }
  );

  it('fails before database access when secure random generation is unavailable', async () => {
    getRandomBytesAsync.mockRejectedValue(new Error('Native crypto unavailable'));
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');

    await expect(
      prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1')
    ).rejects.toThrow('Native crypto unavailable');
    expect(database.execAsync).not.toHaveBeenCalled();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('fails before database access when a generated key cannot be persisted', async () => {
    setItemAsync.mockRejectedValue(new Error('Keystore unavailable'));
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');

    await expect(
      prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1')
    ).rejects.toThrow('Keystore unavailable');
    expect(database.execAsync).not.toHaveBeenCalled();
  });

  it('opens an already encrypted database with its Keystore-backed key', async () => {
    getItemAsync.mockResolvedValue('a'.repeat(64));
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');
    await prepareEncryptedDatabase(database, 'runsphere.test.sqlcipher-key.v1');

    expect(database.execAsync).toHaveBeenCalledWith(`PRAGMA key = '${'a'.repeat(64)}';`);
    expect(database.execAsync).not.toHaveBeenCalledWith(expect.stringContaining('PRAGMA rekey'));
    expect(cipherQueries).toEqual([
      'PRAGMA cipher_version',
      "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1"
    ]);
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('preserves a database that cannot be opened with its device key', async () => {
    getItemAsync.mockResolvedValue('a'.repeat(64));
    const unreadableDatabase: SqlCipherDatabase = {
      execAsync: vi.fn(async () => undefined),
      getFirstAsync: async <T>(sql: string) => {
        if (sql === 'PRAGMA cipher_version') return { cipher_version: '4.7.0' } as T;
        throw new Error('file is encrypted or is not a database');
      }
    };
    const { prepareEncryptedDatabase } = await import('./encrypted-sqlite.native.js');

    await expect(
      prepareEncryptedDatabase(unreadableDatabase, 'runsphere.test.sqlcipher-key.v1')
    ).rejects.toThrow('cannot be opened');
    expect(unreadableDatabase.execAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('PRAGMA rekey')
    );
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
