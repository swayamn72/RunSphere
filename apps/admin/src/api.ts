import type {
  CampaignPreviewResponse,
  CampaignSummary,
  CompetitionSummary,
  EmailTemplate,
  StaffAppeal,
  StaffReport,
  StaffSanction
} from '@runsphere/contracts';

export interface StaffReviewItem {
  id: string;
  status: 'received' | 'validating' | 'rejected';
  submittedAt: string;
  rejectionReason?: string;
  validationErrors: string[];
}

interface LoginResponse {
  accessToken: string;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  ''
);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed with ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const authed = <T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> =>
  request<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...init.headers }
  });

const json = <T>(accessToken: string, path: string, method: string, body?: unknown): Promise<T> =>
  authed<T>(accessToken, path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

export const signIn = (email: string, password: string) =>
  request<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

/**
 * The signed-in account's staff roles. The console gates every area on these
 * using the same predicates the API enforces, so it can never offer an action
 * the server will refuse.
 */
export const getStaffRoles = (accessToken: string) =>
  authed<{ roles: string[] }>(accessToken, '/v1/staff/roles');

export const getStaffReviewQueue = (accessToken: string) =>
  authed<{ data: StaffReviewItem[] }>(accessToken, '/v1/staff/activity-review-queue');

// Moderation (milestone 3.7).
export const getReportQueue = (accessToken: string) =>
  authed<{ data: StaffReport[] }>(accessToken, '/v1/staff/reports');

export const resolveReport = (
  accessToken: string,
  reportId: string,
  body: {
    action: 'dismiss' | 'sanction';
    resolutionNote?: string;
    sanctionKind?: 'warning' | 'social_suspension' | 'account_suspension';
    statement?: string;
    durationHours?: number;
  }
) => json<void>(accessToken, `/v1/staff/reports/${reportId}/resolve`, 'POST', body);

/** Every sanction on one account, so a lift is decided by reading, not guessing. */
export const getAccountSanctions = (accessToken: string, accountId: string) =>
  authed<{ data: StaffSanction[] }>(accessToken, `/v1/staff/accounts/${accountId}/sanctions`);

/** Ends a sanction early. The reason is required and is kept with it. */
export const liftSanction = (accessToken: string, sanctionId: string, reason: string) =>
  json<void>(accessToken, `/v1/staff/sanctions/${sanctionId}/lift`, 'POST', { reason });

export const getAppealQueue = (accessToken: string) =>
  authed<{ data: StaffAppeal[] }>(accessToken, '/v1/staff/appeals');

export const decideAppeal = (
  accessToken: string,
  appealId: string,
  body: { decision: 'upheld' | 'overturned'; decisionNote: string }
) => json<void>(accessToken, `/v1/staff/appeals/${appealId}/decision`, 'POST', body);

// Competitions (milestone 3.6). The member list is the one a staff account
// reads too: there is no separate staff view, so a draft is visible only to
// the account that created it until it is announced.
export const getCompetitions = (accessToken: string) =>
  authed<{ data: CompetitionSummary[] }>(accessToken, '/v1/competitions');

export const createCompetition = (
  accessToken: string,
  body: {
    title: string;
    mode: 'active_minutes' | 'active_days';
    periodStart: string;
    lengthDays: number;
    minPriorActiveWeeks?: number;
    rewards?: string;
    disputePeriodHours?: number;
  }
) => json<CompetitionSummary>(accessToken, '/v1/staff/competitions', 'POST', body);

export const setCompetitionStatus = (
  accessToken: string,
  competitionId: string,
  publish: boolean
) =>
  json<CompetitionSummary>(accessToken, `/v1/staff/competitions/${competitionId}/status`, 'POST', {
    publish
  });

// Campaign email (milestones 3.9 and 3.10).
export const getCampaigns = (accessToken: string) =>
  authed<{ data: CampaignSummary[] }>(accessToken, '/v1/staff/campaigns');

export const createCampaign = (
  accessToken: string,
  body: {
    templateKey: string;
    audience: { consentRequired: boolean; recencyBandDays?: number };
    sendCap: number;
  }
) => json<CampaignSummary>(accessToken, '/v1/staff/campaigns', 'POST', body);

export const previewCampaign = (accessToken: string, campaignId: string) =>
  authed<CampaignPreviewResponse>(accessToken, `/v1/staff/campaigns/${campaignId}/preview`);

export const scheduleCampaign = (accessToken: string, campaignId: string, scheduledFor: string) =>
  json<CampaignSummary>(accessToken, `/v1/staff/campaigns/${campaignId}/schedule`, 'POST', {
    scheduledFor
  });

export const cancelCampaign = (accessToken: string, campaignId: string) =>
  json<CampaignSummary>(accessToken, `/v1/staff/campaigns/${campaignId}/cancel`, 'POST');

export const getEmailTemplates = (accessToken: string) =>
  authed<{ data: EmailTemplate[] }>(accessToken, '/v1/staff/email-templates');

export const publishEmailTemplate = (
  accessToken: string,
  body: { key: string; subject: string; body: string }
) => json<EmailTemplate>(accessToken, '/v1/staff/email-templates', 'POST', body);

/** One open export or erasure request, as the privacy queue shows it. */
export interface PrivacyRequest {
  accountId: string;
  kind: 'export' | 'deletion';
  requestedAt: string;
  expiresAt?: string;
  openForHours: number;
}

export interface RuleVersion {
  kind: string;
  version: number;
  definition: unknown;
  effectiveAt: string;
  supersededAt?: string;
  live: boolean;
}

/**
 * Open privacy requests and the count of erasures that converged (milestone
 * 3.12). Read-only: the worker performs deletion, and a console that deleted
 * an account outside that path would be a second way to destroy data.
 */
export const getPrivacyQueue = (accessToken: string) =>
  authed<{ completedDeletions: number; data: PrivacyRequest[] }>(
    accessToken,
    '/v1/staff/privacy/requests'
  );

/** Published rule versions. Read-only: rules are published by migration. */
export const getRuleVersions = (accessToken: string) =>
  authed<{ data: RuleVersion[] }>(accessToken, '/v1/staff/rules');
