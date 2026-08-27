export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const accessTokenKey = 'runsphere.auth.access-token';
const refreshTokenKey = 'runsphere.auth.refresh-token';
const sessionMetadataKey = 'runsphere.auth.session-metadata';

export const createAuthStorage = (store: SecureKeyValueStore) => ({
  async read(): Promise<AuthSession | undefined> {
    const [accessToken, refreshToken, rawMetadata] = await Promise.all([
      store.getItemAsync(accessTokenKey),
      store.getItemAsync(refreshTokenKey),
      store.getItemAsync(sessionMetadataKey)
    ]);
    if (!accessToken || !refreshToken || !rawMetadata) {
      return undefined;
    }

    const metadata = JSON.parse(rawMetadata) as Pick<AuthSession, 'expiresInSeconds'>;
    return { accessToken, refreshToken, expiresInSeconds: metadata.expiresInSeconds };
  },

  async save(session: AuthSession): Promise<void> {
    await Promise.all([
      store.setItemAsync(accessTokenKey, session.accessToken),
      store.setItemAsync(refreshTokenKey, session.refreshToken),
      store.setItemAsync(
        sessionMetadataKey,
        JSON.stringify({ expiresInSeconds: session.expiresInSeconds })
      )
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      store.deleteItemAsync(accessTokenKey),
      store.deleteItemAsync(refreshTokenKey),
      store.deleteItemAsync(sessionMetadataKey)
    ]);
  }
});

export type AuthStorage = ReturnType<typeof createAuthStorage>;
