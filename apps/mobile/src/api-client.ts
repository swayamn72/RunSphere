import type {
  AccountDeletionResponse,
  AccountExportResponse,
  AchievementListResponse,
  AchievementStatus,
  AchievementSyncResponse,
  ActivityDetailResponse,
  ActivityStatusResponse,
  BlockCreateRequest,
  BlockedAccount,
  BlockListResponse,
  BlockResponse,
  ChallengeCreateRequest,
  ChallengeListResponse,
  ChallengeRespondRequest,
  ChallengeResult,
  ChallengeSummary,
  Club,
  ClubBoardParticipationRequest,
  ClubBoardResponse,
  ClubChallengeCreateRequest,
  ClubChallengeListResponse,
  ClubChallengeMode,
  ClubChallengeParticipationRequest,
  ClubChallengeStandingsResponse,
  ClubChallengeSummary,
  ClubCreateRequest,
  ClubJoinRequest,
  ClubListResponse,
  ClubMember,
  ClubMemberRoleUpdateRequest,
  ClubMembersResponse,
  ClubRelayCreateRequest,
  ClubRelayListResponse,
  ClubRelaySummary,
  CompetitionEnrollmentRequest,
  CompetitionListResponse,
  CompetitionStandingsResponse,
  CompetitionSummary,
  FriendListResponse,
  FriendRequest,
  FriendRequestCreateRequest,
  FriendRequestCreateResponse,
  FriendRequestListResponse,
  FriendRequestRespondRequest,
  FriendStandingsParticipationRequest,
  FriendStandingsResponse,
  GlobalBoardParticipationRequest,
  GlobalBoardResponse,
  InboxEntry,
  InboxListResponse,
  InboxMarkReadRequest,
  LoginRequest,
  NotificationPreferences,
  NotificationPreferencesUpdateRequest,
  PrivacyZoneRequest,
  PrivacyZoneResponse,
  Profile,
  ProfileUpdateRequest,
  ProgressionSummary,
  ProgressionSyncResponse,
  PushDevice,
  PushDeviceRegisterRequest,
  QuestDetail,
  QuestSummary,
  RegisterRequest,
  ReportAcknowledgement,
  ReportCreateRequest,
  ReportReason,
  ReportSubjectType,
  Sanction,
  SanctionListResponse,
  SafetyContactRequest,
  SafetyContactResponse,
  SafetyShareReadResponse,
  SafetyShareRequest,
  SafetyShareResponse,
  TerritoryEnrollmentRequest,
  TerritorySeasonResponse,
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

/** Typed non-auth API failure for product state decisions without parsing error strings. */
export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

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
export type ActivityStatus = ActivityStatusResponse;
export type ActivityDetail = ActivityDetailResponse;
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
    if (!this.baseUrl) throw new AuthFailure('configuration');
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/quests`);
    } catch (error) {
      throw classifyTransportFailure(error);
    }
    if (response.status === 401 || response.status === 403)
      throw new AuthFailure('invalid-credentials', response.status);
    if (!response.ok)
      throw new ApiFailure(response.status, `Unable to load quests (${response.status}).`);
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
    await this.request('/v1/account/email-verification', { method: 'POST', body: {} });
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
    await this.request(`/v1/safety-contacts/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: {}
    });
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
  /**
   * Report an account or a club (milestone 3.7). The answer is the same
   * whether or not the subject exists and whatever has happened to them: a
   * report is not a lookup. Reporting works on an account you have blocked.
   */
  async fileReport(
    subjectType: ReportSubjectType,
    subjectId: string,
    reason: ReportReason,
    note?: string
  ): Promise<ReportAcknowledgement> {
    const body: ReportCreateRequest = {
      subjectType,
      subjectId,
      reason,
      ...(note ? { note } : {})
    };
    return this.request('/v1/reports', { method: 'POST', body });
  }
  /** Every moderation decision about this account, in force or not. */
  async listSanctions(): Promise<readonly Sanction[]> {
    return (await this.request<SanctionListResponse>('/v1/account/sanctions', { method: 'GET' }))
      .data;
  }
  /** One appeal per decision; `409` means it can no longer be appealed. */
  async appealSanction(sanctionId: string, statement: string): Promise<readonly Sanction[]> {
    return (
      await this.request<SanctionListResponse>(
        `/v1/sanctions/${encodeURIComponent(sanctionId)}/appeal`,
        { method: 'POST', body: { statement } }
      )
    ).data;
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
  /** The activity detail GET is the single server-truth read for Results and sync refresh. */
  async activityStatus(id: string): Promise<ActivityDetail> {
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

  /**
   * Own gameplay profile. A `404` `ApiFailure` means no profile row exists yet;
   * a caller must present an explicit create-profile state and never a
   * fabricated identity.
   */
  async getProfile(): Promise<Profile> {
    return this.request('/v1/profile', { method: 'GET' });
  }
  async updateProfile(update: ProfileUpdateRequest): Promise<Profile> {
    return this.request('/v1/profile', { method: 'PUT', body: update });
  }
  /**
   * The server answers identically for an unknown address and a recorded
   * request (ADR-0007), so a caller must not infer that an account exists.
   */
  async sendFriendRequest(
    invitation: FriendRequestCreateRequest
  ): Promise<FriendRequestCreateResponse> {
    return this.request('/v1/friends/requests', { method: 'POST', body: invitation });
  }
  /** Incoming pending requests only; the server never returns counterpart emails. */
  async listFriendRequests(): Promise<readonly FriendRequest[]> {
    return (
      await this.request<FriendRequestListResponse>('/v1/friends/requests', { method: 'GET' })
    ).data;
  }
  async respondFriendRequest(requestId: string, accept: boolean): Promise<void> {
    const body: FriendRequestRespondRequest = { accept };
    await this.request(`/v1/friends/requests/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      body,
      empty: true
    });
  }
  /** Mutual friendships only; membership is the server's authorization boundary. */
  async listFriends(): Promise<readonly Profile[]> {
    return (await this.request<FriendListResponse>('/v1/friends', { method: 'GET' })).data;
  }
  /**
   * Weekly friend board (ADR-0007). `participating` is false until the account
   * joins, and `entries` stays empty while it is: a caller must present the
   * opt-in, never an empty board as though nobody moved.
   */
  async getFriendStandings(): Promise<FriendStandingsResponse> {
    return this.request('/v1/friends/standings', { method: 'GET' });
  }
  /** Joining and leaving the friend board is independent of activity visibility. */
  /**
   * The opt-in global board (milestone 3.5). It is materialized by the worker,
   * so this is a plain read: `participating: false` comes back with no entries,
   * and an opted-in reader with no counted minutes yet has no `me` and no
   * division until the next recompute ranks them.
   */
  async getGlobalBoard(): Promise<GlobalBoardResponse> {
    return this.request('/v1/boards/global', { method: 'GET' });
  }
  /**
   * Scheduled competitions (milestone 3.6). A draft never appears here — it
   * has not been announced — and every entry carries the reader's own state
   * and whether their history clears the published eligibility band.
   */
  async listCompetitions(): Promise<readonly CompetitionSummary[]> {
    return (await this.request<CompetitionListResponse>('/v1/competitions', { method: 'GET' }))
      .data;
  }
  /**
   * Enter or leave one competition. `403` means the published eligibility band
   * was not met and says which; `409` means the window has already closed.
   */
  async setCompetitionEnrollment(
    competitionId: string,
    enrolled: boolean
  ): Promise<CompetitionSummary> {
    const body: CompetitionEnrollmentRequest = { enrolled };
    return this.request(`/v1/competitions/${encodeURIComponent(competitionId)}/enrollment`, {
      method: 'PUT',
      body
    });
  }
  /**
   * Standings for one competition: empty until the reader has entered, live
   * while the window is open, and the stored result afterwards — flagged
   * `provisional` until the dispute period has elapsed.
   */
  async getCompetitionStandings(competitionId: string): Promise<CompetitionStandingsResponse> {
    return this.request(`/v1/competitions/${encodeURIComponent(competitionId)}/standings`, {
      method: 'GET'
    });
  }
  /**
   * The territory season (milestone 4.1). Territory capture is not switched on:
   * a season records who is taking part and in which division, and the response
   * says so whether or not a season exists.
   */
  async getTerritorySeason(): Promise<TerritorySeasonResponse> {
    return this.request('/v1/territory/season', { method: 'GET' });
  }
  /**
   * Join or leave the season. The division is decided once, when joining, from
   * how many weeks the account has been active; re-joining keeps the division
   * already assigned rather than rerolling it.
   */
  async setTerritoryEnrollment(
    seasonId: string,
    enrolled: boolean
  ): Promise<TerritorySeasonResponse> {
    const body: TerritoryEnrollmentRequest = { enrolled };
    return this.request(`/v1/territory/seasons/${encodeURIComponent(seasonId)}/enrollment`, {
      method: 'PUT',
      body
    });
  }
  /** Off by default, and separately revocable from every other board scope. */
  async setGlobalBoardParticipation(participating: boolean): Promise<boolean> {
    const body: GlobalBoardParticipationRequest = { participating };
    return (
      await this.request<GlobalBoardParticipationRequest>('/v1/boards/global/participation', {
        method: 'PUT',
        body
      })
    ).participating;
  }
  async setFriendStandingsParticipation(participating: boolean): Promise<boolean> {
    const body: FriendStandingsParticipationRequest = { participating };
    return (
      await this.request<FriendStandingsParticipationRequest>(
        '/v1/friends/standings/participation',
        { method: 'PUT', body }
      )
    ).participating;
  }
  /**
   * Live blocks. A block removes the friendship and revokes pending requests,
   * so a blocked account is absent from every other list; this is the only
   * surface that can find it again to unblock it.
   */
  async listBlocks(): Promise<readonly BlockedAccount[]> {
    return (await this.request<BlockListResponse>('/v1/blocks', { method: 'GET' })).data;
  }
  async blockAccount(block: BlockCreateRequest): Promise<BlockResponse> {
    return this.request('/v1/blocks', { method: 'POST', body: block });
  }
  async unblockAccount(accountId: string): Promise<BlockResponse> {
    return this.request(`/v1/blocks/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  }

  /** Durable inbox of record (ADR-0009). Entries carry no location or score detail. */
  async getNotificationInbox(): Promise<readonly InboxEntry[]> {
    return (await this.request<InboxListResponse>('/v1/notifications', { method: 'GET' })).data;
  }
  async markNotificationsRead(ids: readonly string[]): Promise<void> {
    const body: InboxMarkReadRequest = { ids: [...ids] };
    await this.request('/v1/notifications/read', { method: 'POST', body, empty: true });
  }
  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.request('/v1/notifications/preferences', { method: 'GET' });
  }
  async updateNotificationPreferences(
    update: NotificationPreferencesUpdateRequest
  ): Promise<NotificationPreferences> {
    return this.request('/v1/notifications/preferences', { method: 'PUT', body: update });
  }

  /**
   * Push registration (ADR-0009). Registering an address is not consent to be
   * pushed: the categories, quiet hours, and daily cap in
   * `updateNotificationPreferences` still decide, server-side, whether any
   * given notification wakes the device. The push itself carries only the
   * inbox id and its deep link, so the entry is always read back from
   * `getNotificationInbox`.
   */
  async registerPushDevice(token: string): Promise<PushDevice> {
    const body: PushDeviceRegisterRequest = { token, platform: 'android' };
    return this.request('/v1/notifications/devices', { method: 'POST', body });
  }
  /** Revoked on sign-out so a shared device stops receiving the account wake-ups. */
  async revokePushDevice(deviceId: string): Promise<void> {
    await this.request(`/v1/notifications/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      empty: true
    });
  }

  /**
   * Cosmetic progression only (ADR-0005). The server owns XP, level, and
   * weekly consistency; the client never derives or projects them locally.
   */
  async getProgressionSummary(): Promise<ProgressionSummary> {
    return this.request('/v1/progression', { method: 'GET' });
  }
  /** Idempotent finalization of closed weeks; the open week stays a projection. */
  async syncProgression(): Promise<ProgressionSyncResponse> {
    return this.request('/v1/progression/sync', { method: 'POST', body: {} });
  }
  async getAchievements(): Promise<readonly AchievementStatus[]> {
    return (await this.request<AchievementListResponse>('/v1/achievements', { method: 'GET' }))
      .data;
  }
  /** Idempotent re-evaluation; the server awards, so a repeat call adds nothing. */
  async syncAchievements(): Promise<AchievementSyncResponse> {
    return this.request('/v1/achievements/sync', { method: 'POST', body: {} });
  }

  // Challenge routes are live as of milestone 2.5 (`018_challenges.sql` plus
  // `/v1/challenges`). Two failures are product states, not bugs: `422` means
  // the published rule does not enable that mode or length, and `409` means a
  // challenge with that friend is already open, an invite is no longer open, or
  // a closed window has not been scored yet. A caller must present each
  // explicitly rather than as a generic error.
  async createChallenge(challenge: ChallengeCreateRequest): Promise<ChallengeSummary> {
    return this.request('/v1/challenges', { method: 'POST', body: challenge });
  }
  async listChallenges(): Promise<readonly ChallengeSummary[]> {
    return (await this.request<ChallengeListResponse>('/v1/challenges', { method: 'GET' })).data;
  }
  async respondChallenge(challengeId: string, accept: boolean): Promise<ChallengeSummary> {
    const body: ChallengeRespondRequest = { accept };
    return this.request(`/v1/challenges/${encodeURIComponent(challengeId)}`, {
      method: 'PATCH',
      body
    });
  }
  /** Privacy-minimized pace-neutral totals; never pace, distance, or route. */
  async getChallengeResult(challengeId: string): Promise<ChallengeResult> {
    return this.request(`/v1/challenges/${encodeURIComponent(challengeId)}/result`, {
      method: 'GET'
    });
  }

  // Clubs (milestone 3.1). A club is private and invite-code-only: there is no
  // public list or search to call. Every read starts from the caller's own
  // membership, and a club the caller is not in answers `404` rather than
  // `403`, so a club id is never confirmed from outside.
  async createClub(name: string): Promise<Club> {
    const body: ClubCreateRequest = { name };
    return this.request('/v1/clubs', { method: 'POST', body });
  }
  async listClubs(): Promise<readonly Club[]> {
    return (await this.request<ClubListResponse>('/v1/clubs', { method: 'GET' })).data;
  }
  /** `404` means no live club has that code; the code is the whole access path. */
  async joinClub(inviteCode: string): Promise<Club> {
    const body: ClubJoinRequest = { inviteCode };
    return this.request('/v1/clubs/join', { method: 'POST', body });
  }
  /** A roster omits accounts blocked in either direction; the count does not. */
  async listClubMembers(clubId: string): Promise<readonly ClubMember[]> {
    return (
      await this.request<ClubMembersResponse>(`/v1/clubs/${encodeURIComponent(clubId)}/members`, {
        method: 'GET'
      })
    ).data;
  }
  /** `409` means the owner must hand the club on or archive it before leaving. */
  async leaveClub(clubId: string): Promise<void> {
    await this.request(`/v1/clubs/${encodeURIComponent(clubId)}/membership`, {
      method: 'DELETE',
      empty: true
    });
  }
  async removeClubMember(clubId: string, accountId: string): Promise<void> {
    await this.request(
      `/v1/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(accountId)}`,
      { method: 'DELETE', empty: true }
    );
  }
  async setClubMemberRole(
    clubId: string,
    accountId: string,
    role: 'admin' | 'member'
  ): Promise<ClubMember> {
    const body: ClubMemberRoleUpdateRequest = { role };
    return this.request(
      `/v1/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(accountId)}`,
      { method: 'PATCH', body }
    );
  }
  /**
   * Relay weeks, newest first. Every figure is an aggregate plus the reader's
   * own units: the API has no per-member breakdown to ask for, because a club
   * receives aggregate completion data only.
   */
  async listClubRelays(clubId: string): Promise<readonly ClubRelaySummary[]> {
    return (
      await this.request<ClubRelayListResponse>(`/v1/clubs/${encodeURIComponent(clubId)}/relays`, {
        method: 'GET'
      })
    ).data;
  }
  /**
   * Sets the target for the open week only; the week is never a parameter, so
   * a closed week cannot be retargeted. `422` means the published rule does not
   * allow that target, or no relay rule is published at all.
   */
  async setClubRelayTarget(clubId: string, targetUnits: number): Promise<ClubRelaySummary> {
    const body: ClubRelayCreateRequest = { targetUnits };
    return this.request(`/v1/clubs/${encodeURIComponent(clubId)}/relays`, {
      method: 'POST',
      body
    });
  }
  /**
   * The club's weekly board (milestone 3.3). Membership answers `404` when it
   * is missing, and `participating: false` comes back with no entries at all:
   * reading other members' scores means publishing your own.
   */
  async getClubBoard(clubId: string): Promise<ClubBoardResponse> {
    return this.request(`/v1/clubs/${encodeURIComponent(clubId)}/board`, { method: 'GET' });
  }
  /**
   * Joining or leaving club boards. One decision in the `club` scope covering
   * every club the account is in, which is why no club id is in this path.
   */
  async setClubBoardParticipation(participating: boolean): Promise<boolean> {
    const body: ClubBoardParticipationRequest = { participating };
    return (
      await this.request<ClubBoardParticipationRequest>('/v1/clubs/board/participation', {
        method: 'PUT',
        body
      })
    ).participating;
  }
  /**
   * The club's challenges, newest first (milestone 3.4). Each carries how many
   * members are in it and whether the reader is one; who else is in it is the
   * standings' business, and only for a participant.
   */
  async listClubChallenges(clubId: string): Promise<readonly ClubChallengeSummary[]> {
    return (
      await this.request<ClubChallengeListResponse>(
        `/v1/clubs/${encodeURIComponent(clubId)}/challenges`,
        { method: 'GET' }
      )
    ).data;
  }
  /**
   * Open a contest for the club. Owner or admin only, and it enrols nobody —
   * joining publishes a personal score, so every member does that themselves.
   * `409` means the club already has one running; `422` means the published
   * rule does not allow that mode or length.
   */
  async openClubChallenge(
    clubId: string,
    mode: ClubChallengeMode,
    lengthDays: number
  ): Promise<ClubChallengeSummary> {
    const body: ClubChallengeCreateRequest = { mode, lengthDays };
    return this.request(`/v1/clubs/${encodeURIComponent(clubId)}/challenges`, {
      method: 'POST',
      body
    });
  }
  /**
   * Join or leave one contest. Joining covers the whole window, including the
   * days already passed, because everyone in it is scored over the same days.
   */
  async setClubChallengeParticipation(
    clubId: string,
    challengeId: string,
    participating: boolean
  ): Promise<ClubChallengeSummary> {
    const body: ClubChallengeParticipationRequest = { participating };
    return this.request(
      `/v1/clubs/${encodeURIComponent(clubId)}/challenges/${encodeURIComponent(
        challengeId
      )}/participation`,
      { method: 'PUT', body }
    );
  }
  /** Ends a running contest for everyone; nothing is scored and no result kept. */
  async cancelClubChallenge(clubId: string, challengeId: string): Promise<ClubChallengeSummary> {
    return this.request(
      `/v1/clubs/${encodeURIComponent(clubId)}/challenges/${encodeURIComponent(
        challengeId
      )}/cancel`,
      { method: 'POST' }
    );
  }
  /**
   * Standings for one contest. Empty while the reader has not joined, live
   * while the window is open, and the stored result once `final` is true.
   */
  async getClubChallengeStandings(
    clubId: string,
    challengeId: string
  ): Promise<ClubChallengeStandingsResponse> {
    return this.request(
      `/v1/clubs/${encodeURIComponent(clubId)}/challenges/${encodeURIComponent(
        challengeId
      )}/standings`,
      { method: 'GET' }
    );
  }
  /** Archiving ends access for every member; the membership record survives. */
  async archiveClub(clubId: string): Promise<Club> {
    return this.request(`/v1/clubs/${encodeURIComponent(clubId)}/archive`, { method: 'POST' });
  }

  private async request<T>(
    path: string,
    request: { method: string; headers?: Record<string, string>; body?: unknown; empty?: boolean },
    authenticated = true,
    retried = false
  ): Promise<T> {
    if (!this.baseUrl) throw new AuthFailure('configuration');
    const session = authenticated ? await this.auth?.read() : undefined;
    if (authenticated && !session) throw new AuthFailure('invalid-credentials');
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
    if (response.status === 401 || response.status === 403)
      throw new AuthFailure('invalid-credentials', response.status);
    if (!response.ok) throw new ApiFailure(response.status, await responseMessage(response, path));
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
