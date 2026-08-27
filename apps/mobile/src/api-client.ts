import type { LoginRequest, QuestSummary, RegisterRequest } from '@runsphere/contracts';
import type { AuthSession, AuthStorage } from './auth-storage';
import { getApiBaseUrl } from './api-config';

export type { AuthSession } from './auth-storage';

export class MobileApiClient {
  constructor(
    private readonly baseUrl = getApiBaseUrl(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly auth?: AuthStorage
  ) {}

  async register(account: RegisterRequest): Promise<AuthSession> {
    return this.saveSession(await this.authRequest('/v1/auth/register', account));
  }

  async login(credentials: LoginRequest): Promise<AuthSession> {
    return this.saveSession(await this.authRequest('/v1/auth/login', credentials));
  }

  async refresh(): Promise<AuthSession> {
    const session = await this.auth?.read();
    if (!session) {
      throw new Error('No signed-in session is available.');
    }
    return this.saveSession(
      await this.authRequest('/v1/auth/refresh', { refreshToken: session.refreshToken })
    );
  }

  async logout(): Promise<void> {
    const session = await this.auth?.read();
    try {
      if (session && this.baseUrl) {
        await this.fetcher(`${this.baseUrl}/v1/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken })
        });
      }
    } finally {
      await this.auth?.clear();
    }
  }

  async listQuests(): Promise<readonly QuestSummary[]> {
    if (!this.baseUrl) {
      return [];
    }

    const response = await this.fetcher(`${this.baseUrl}/v1/quests`);
    if (!response.ok) {
      throw new Error(`Unable to load quests (${response.status}).`);
    }

    const body = (await response.json()) as { data: QuestSummary[] };
    return body.data;
  }

  private async authRequest(
    path: string,
    body: RegisterRequest | LoginRequest | { refreshToken: string }
  ): Promise<AuthSession> {
    if (!this.baseUrl) {
      throw new Error('A RunSphere API URL is required to sign in.');
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error('Unable to complete account authentication.');
    }
    return (await response.json()) as AuthSession;
  }

  private async saveSession(session: AuthSession): Promise<AuthSession> {
    await this.auth?.save(session);
    return session;
  }
}
