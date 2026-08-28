import type {
  AccountDeletionResponse,
  AccountExportResponse,
  LoginRequest,
  PrivacyZoneRequest,
  PrivacyZoneResponse,
  QuestDetail,
  QuestSummary,
  RegisterRequest,
  SafetyContactRequest,
  SafetyContactResponse,
  SafetyShareReadResponse,
  SafetyShareRequest,
  SafetyShareResponse,
  VisibilityRequest,
  VisibilityResponse,
  WeeklyGoalRequest,
  WeeklyGoalResponse
} from '@runsphere/contracts';
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
export type { SafetyContactResponse } from '@runsphere/contracts';
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
    rejectedPointCount?: number;
    rejectedGapCount?: number;
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
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/quests`);
    } catch (error) {
      throw classifyTransportFailure(error);
    }
    if (!response.ok) throw new Error(`Unable to load quests (${response.status}).`);
    return ((await response.json()) as { data: QuestSummary[] }).data;
  }
  async getQuest(id: string): Promise<QuestDetail> {
    return this.request<QuestDetail>(
      `/v1/quests/${encodeURIComponent(id)}`,
      { method: 'GET' },
      false
    );
  }
  async getWeeklyGoal(): Promise<WeeklyGoalResponse> {
    return this.request('/v1/goals/weekly', { method: 'GET' });
  }
  async saveWeeklyGoal(goal: WeeklyGoalRequest): Promise<WeeklyGoalResponse> {
    return this.request('/v1/goals/weekly', { method: 'PUT', body: goal });
  }
  async createPrivacyZone(zone: PrivacyZoneRequest): Promise<PrivacyZoneResponse> {
    return this.request('/v1/privacy-zones', { method: 'POST', body: zone });
  }
  async updateVisibility(visibility: VisibilityRequest): Promise<VisibilityResponse> {
    return this.request('/v1/account/visibility', { method: 'PUT', body: visibility });
  }
  async requestEmailVerification(): Promise<void> {
    await this.request('/v1/account/email-verification', { method: 'POST' });
  }
  async listSafetyContacts(): Promise<readonly SafetyContactResponse[]> {
    return (
      await this.request<{ data: SafetyContactResponse[] }>('/v1/safety-contacts', {
        method: 'GET'
      })
    ).data;
  }
  async inviteSafetyContact(contact: SafetyContactRequest): Promise<SafetyContactResponse> {
    return this.request('/v1/safety-contacts', { method: 'POST', body: contact });
  }
  async acceptSafetyContact(id: string): Promise<void> {
    await this.request(`/v1/safety-contacts/${encodeURIComponent(id)}/accept`, { method: 'POST' });
  }
  async startSafetyShare(share: SafetyShareRequest): Promise<SafetyShareResponse> {
    return this.request('/v1/safety-shares', { method: 'POST', body: share });
  }
  async stopSafetyShare(id: string): Promise<void> {
    await this.request(`/v1/safety-shares/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      empty: true
    });
  }
  async readDelayedSafetyShare(id: string): Promise<SafetyShareReadResponse> {
    return this.request(`/v1/safety-shares/${encodeURIComponent(id)}/updates`, { method: 'GET' });
  }
  async exportAccount(): Promise<AccountExportResponse> {
    return this.request('/v1/account/export', { method: 'GET' });
  }
  async requestAccountDeletion(): Promise<AccountDeletionResponse> {
    return this.request('/v1/account', { method: 'DELETE' });
  }

  async createActivity(
    movementType: ActivityMovement,
    idempotencyKey: string
  ): Promise<ActivityStatus> {
    return this.request('/v1/activities', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: { movementType }
    });
  }
  async uploadActivityChunk(id: string, chunk: ActivityChunk): Promise<void> {
    await this.request(`/v1/activities/${id}/chunks`, {
      method: 'PUT',
      headers: { 'x-chunk-checksum': chunkChecksum(chunk), 'content-encoding': 'identity' },
      body: chunk,
      empty: true
    });
  }
  async finalizeActivity(id: string, chunks: readonly ActivityChunk[]): Promise<ActivityStatus> {
    return this.request(`/v1/activities/${id}/finalize`, {
      method: 'POST',
      body: { expectedChunkCount: chunks.length, checksum: aggregateChecksum(chunks) }
    });
  }
  async activityStatus(id: string): Promise<ActivityStatus> {
    return this.request(`/v1/activities/${id}`, { method: 'GET' });
  }
  async recoverActivitySync(id: string, expectedChunkCount: number): Promise<ActivityStatus> {
    return this.request(
      `/v1/activities/${id}/sync?expectedChunkCount=${encodeURIComponent(expectedChunkCount)}`,
      { method: 'GET' }
    );
  }
  async listActivities(): Promise<ActivityStatus[]> {
    return (await this.request<{ data: ActivityStatus[] }>('/v1/activities', { method: 'GET' }))
      .data;
  }
  async deleteActivity(id: string): Promise<void> {
    await this.request(`/v1/activities/${id}`, { method: 'DELETE', empty: true });
  }

  private async request<T>(
    path: string,
    request: { method: string; headers?: Record<string, string>; body?: unknown; empty?: boolean },
    authenticated = true,
    retried = false
  ): Promise<T> {
    if (!this.baseUrl) throw new AuthFailure('configuration');
    const session = authenticated ? await this.auth?.read() : undefined;
    if (authenticated && !session) throw new Error('No signed-in session is available.');
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: request.method,
        headers: {
          ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
          'content-type': 'application/json',
          ...request.headers
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
      });
    } catch (error) {
      throw classifyTransportFailure(error);
    }
    if (response.status === 401 && authenticated && !retried) {
      await this.refresh();
      return this.request(path, request, authenticated, true);
    }
    if (!response.ok) throw new Error(await responseMessage(response, path));
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

const responseMessage = async (response: Response, path: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) return payload.message;
  } catch {
    // The API response may not contain a JSON error body.
  }
  return `Request to ${path} failed (${response.status}).`;
};
