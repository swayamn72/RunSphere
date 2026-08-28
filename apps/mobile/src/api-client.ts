import type { LoginRequest, QuestSummary, RegisterRequest } from '@runsphere/contracts';
import type { AuthSession, AuthStorage } from './auth-storage-core';
import { getApiBaseUrl } from './api-config';
import { canonicalJson, sha256 } from './activity-checksum';
import {
  AuthFailure,
  classifyAuthResponse,
  classifyTransportFailure,
  reportAuthFailure
} from './auth-failure';

export type { AuthSession } from './auth-storage-core';
export type ActivityMovement = 'walk' | 'run' | 'hike';
export interface ActivityPoint {
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyMeters?: number;
}
export interface ActivityChunk {
  sequence: number;
  points: ActivityPoint[];
}
export interface ActivityStatus {
  id: string;
  status: 'received' | 'validating' | 'accepted' | 'rejected' | 'derived' | 'deleted';
  missingSequences?: number[];
  summary?: {
    distanceMeters: number;
    durationSeconds: number;
    pointCount: number;
    privacyTrimmed: boolean;
  };
  rejectionReason?: string;
  validationErrors?: string[];
}
export const chunkChecksum = (chunk: ActivityChunk) => sha256(canonicalJson(chunk));
export const aggregateChecksum = (chunks: readonly ActivityChunk[]) =>
  sha256(
    chunks
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(chunkChecksum)
      .join('')
  );

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
    if (!session) throw new Error('No signed-in session is available.');
    return this.saveSession(
      await this.authRequest('/v1/auth/refresh', { refreshToken: session.refreshToken }, 'refresh')
    );
  }
  async logout(): Promise<void> {
    const session = await this.auth?.read();
    if (session && this.baseUrl)
      await this.fetcher(`${this.baseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken })
      });
  }
  async listQuests(): Promise<readonly QuestSummary[]> {
    if (!this.baseUrl) return [];
    const response = await this.fetcher(`${this.baseUrl}/v1/quests`);
    if (!response.ok) throw new Error(`Unable to load quests (${response.status}).`);
    return ((await response.json()) as { data: QuestSummary[] }).data;
  }
  async createActivity(
    movementType: ActivityMovement,
    idempotencyKey: string
  ): Promise<ActivityStatus> {
    return this.activityRequest('/v1/activities', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: { movementType }
    });
  }
  async uploadActivityChunk(id: string, chunk: ActivityChunk): Promise<void> {
    await this.activityRequest(`/v1/activities/${id}/chunks`, {
      method: 'PUT',
      headers: { 'x-chunk-checksum': chunkChecksum(chunk), 'content-encoding': 'identity' },
      body: chunk,
      empty: true
    });
  }
  async finalizeActivity(id: string, chunks: readonly ActivityChunk[]): Promise<ActivityStatus> {
    return this.activityRequest(`/v1/activities/${id}/finalize`, {
      method: 'POST',
      body: { expectedChunkCount: chunks.length, checksum: aggregateChecksum(chunks) }
    });
  }
  async activityStatus(id: string): Promise<ActivityStatus> {
    return this.activityRequest(`/v1/activities/${id}`, { method: 'GET' });
  }
  async listActivities(): Promise<ActivityStatus[]> {
    return (
      await this.activityRequest<{ data: ActivityStatus[] }>('/v1/activities', { method: 'GET' })
    ).data;
  }
  async deleteActivity(id: string): Promise<void> {
    await this.activityRequest(`/v1/activities/${id}`, { method: 'DELETE', empty: true });
  }
  private async activityRequest<T = ActivityStatus>(
    path: string,
    request: { method: string; headers?: Record<string, string>; body?: unknown; empty?: boolean },
    retried = false
  ): Promise<T> {
    if (!this.baseUrl) throw new AuthFailure('configuration');
    const session = await this.auth?.read();
    if (!session) throw new Error('No signed-in session is available.');
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'content-type': 'application/json',
          ...request.headers
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
      });
    } catch (error) {
      throw classifyTransportFailure(error);
    }
    if (response.status === 401 && !retried) {
      await this.refresh();
      return this.activityRequest(path, request, true);
    }
    if (!response.ok) throw new Error(`Activity request failed (${response.status}).`);
    return (request.empty ? undefined : await response.json()) as T;
  }
  private async authRequest(
    path: string,
    body: RegisterRequest | LoginRequest | { refreshToken: string },
    operation: 'register' | 'login' | 'refresh'
  ): Promise<AuthSession> {
    if (!this.baseUrl) throw new AuthFailure('configuration');
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
