import * as SecureStore from 'expo-secure-store';

export interface SqlCipherDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

const createKey = (): string => {
  const bytes = new Uint8Array(32);
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('Secure random key generation is unavailable.');
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};
const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

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
  const existingKey = SecureStore.getItem(keyName);
  if (existingKey) {
    await database.execAsync(`PRAGMA key = ${sqlLiteral(existingKey)};`);
    await verifySqlCipher(database);
    return;
  }

  // Existing installs used a plaintext database. Open it explicitly with the empty
  // SQLCipher key, then encrypt it in place before recording any new data.
  await database.execAsync("PRAGMA key = '';");
  try {
    await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1"
    );
  } catch {
    throw new Error('Local activity storage cannot be recovered without its encryption key.');
  }
  const key = createKey();
  await database.execAsync(`PRAGMA rekey = ${sqlLiteral(key)};`);
  await verifySqlCipher(database);
  SecureStore.setItem(keyName, key);
};
