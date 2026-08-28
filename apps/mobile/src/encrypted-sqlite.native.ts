import * as SecureStore from 'expo-secure-store';

export interface SqlCipherDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

const createKey = (): string => {
  const bytes = new Uint8Array(32);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random key generation is unavailable.');
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};
const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Opens an Expo SQLite database under its distinct Keystore-backed SQLCipher key. */
export const prepareEncryptedDatabase = async (
  database: SqlCipherDatabase,
  keyName: string
): Promise<void> => {
  let key = SecureStore.getItem(keyName);
  if (!key) {
    key = createKey();
    SecureStore.setItem(keyName, key);
  }
  await database.execAsync(`PRAGMA key = ${sqlLiteral(key)};`);
  const cipher = await database.getFirstAsync<{ cipher_version: string | null }>('PRAGMA cipher_version');
  if (!cipher?.cipher_version) throw new Error('SQLCipher is required for local storage.');
};
