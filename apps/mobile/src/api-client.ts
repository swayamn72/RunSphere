import type { LoginRequest, QuestSummary, RegisterRequest } from '@runsphere/contracts';
import type { AuthSession, AuthStorage } from './auth-storage-core';
import { getApiBaseUrl } from './api-config';
import {
  AuthFailure,
  classifyAuthResponse,
  classifyTransportFailure,
  reportAuthFailure
} from './auth-failure';

export type { AuthSession } from './auth-storage-core';

export class MobileApiClient {
  constructor(
    private readonly baseUrl = getApiBaseUrl(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly auth?: AuthStorage
  ) {}

  async register(account: RegisterRequest): Promise<AuthSession> {
    return this.saveSession(await this.authRequest('/v1/auth/register', account, 'register'));
  }

  async login(credentials: LoginRequest): Promise<AuthSession> {
    return this.saveSession(await this.authRequest('/v1/auth/login', credentials, 'login'));
  }

  async refresh(): Promise<AuthSession> {
    const session = await this.auth?.read();
    if (!session) {
      throw new Error('No signed-in session is available.');
    }
    return this.saveSession(
      await this.authRequest('/v1/auth/refresh', { refreshToken: session.refreshToken }, 'refresh')
    );
  }

  async logout(): Promise<void> {
    const session = await this.auth?.read();
    if (session && this.baseUrl) {
      await this.fetcher(`${this.baseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken })
      });
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
    body: RegisterRequest | LoginRequest | { refreshToken: string },
    operation: 'register' | 'login' | 'refresh'
  ): Promise<AuthSession> {
    if (!this.baseUrl) {
      throw new AuthFailure('configuration');
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (error) {
      const failure = classifyTransportFailure(error);
      reportAuthFailure(operation, failure);
      throw failure;
    }

    if (!response.ok) {
      const failure = classifyAuthResponse(response.status, operation);
      reportAuthFailure(operation, failure);
      throw failure;
    }
    return (await response.json()) as AuthSession;
  }

  private async saveSession(session: AuthSession): Promise<AuthSession> {
    await this.auth?.save(session);
    return session;
  }
}
