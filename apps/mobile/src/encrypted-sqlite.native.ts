import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export interface SqlCipherDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

const createKey = async (): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};
const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const provisionKey = async (keyName: string): Promise<string> => {
  const existingKey = await SecureStore.getItemAsync(keyName);
  if (existingKey !== null) {
    if (existingKey.trim().length === 0) throw new Error('Local storage encryption key is empty.');
    return existingKey;
  }

  const key = await createKey();
  // Persist first so a process death can never leave an encrypted database without its key.
  await SecureStore.setItemAsync(keyName, key);
  return key;
};

const verifySqlCipher = async (database: SqlCipherDatabase): Promise<void> => {
  const cipher = await database.getFirstAsync<{ cipher_version: string | null }>(
    'PRAGMA cipher_version'
  );
  if (!cipher?.cipher_version) throw new Error('SQLCipher is required for local storage.');
};

/** Opens an Expo SQLite database under its distinct Keystore-backed SQLCipher key. */
export const prepareEncryptedDatabase = async (
  database: SqlCipherDatabase,
  keyName: string
): Promise<void> => {
  const key = await provisionKey(keyName);
  await database.execAsync(`PRAGMA key = ${sqlLiteral(key)};`);
  await verifySqlCipher(database);

  try {
    // Force the first schema read while the key is applied. A plaintext database or a database
    // whose Keystore key was lost must remain untouched rather than being rekeyed speculatively.
    await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1"
    );
  } catch {
    throw new Error('Local encrypted storage cannot be opened with its device key.');
  }
};
