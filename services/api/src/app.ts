import { randomBytes } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { ApiConfig } from '@runsphere/config';
import { createMetrics } from '@runsphere/observability';
import {
  ActivityAuthorizationHeadersSchema,
  ActivityChunkHeadersSchema,
  ActivityChunkRequestSchema,
  ActivityChunkResponseSchema,
  ActivityCreateHeadersSchema,
  ActivityCreateRequestSchema,
  ActivityCreateResponseSchema,
  ActivityDeleteResponseSchema,
  ActivityDetailResponseSchema,
  ActivityFinalizeRequestSchema,
  ActivityFinalizeResponseSchema,
  ActivityListResponseSchema,
  ActivityParamsSchema,
  ActivitySyncQuerySchema,
  ActivitySyncStatusResponseSchema,
  activityFinalizeChecksumInput,
  AuthResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ReadinessResponseSchema,
  EmailVerificationCompleteRequestSchema,
  LoginRequestSchema,
  AccountDeletionResponseSchema,
  AccountExportResponseSchema,
  PrivacyZoneRequestSchema,
  PrivacyZoneResponseSchema,
  EmailVerificationRequestResponseSchema,
  SafetyContactAcceptResponseSchema,
  SafetyContactListResponseSchema,
  SafetyContactRequestSchema,
  SafetyContactResponseSchema,
  SafetyContactParamsSchema,
  SafetyShareParamsSchema,
  SafetyShareReadResponseSchema,
  SafetyShareRequestSchema,
  SafetyShareResponseSchema,
  SafetyShareUpdateRequestSchema,
  VisibilityRequestSchema,
  VisibilityResponseSchema,
  QuestDetailSchema,
  QuestListResponseSchema,
  QuestNotFoundResponseSchema,
  QuestParamsSchema,
  WeeklyGoalRequestSchema,
  WeeklyGoalResponseSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  StaffReviewAuthorizationHeadersSchema,
  StaffReviewQueueResponseSchema,
  type ActivityChunkRequest,
  type ActivityCreateRequest,
  type ActivityFinalizeRequest,
  type EmailVerificationCompleteRequest,
  type LoginRequest,
  type PrivacyZoneRequest,
  type SafetyContactRequest,
  type SafetyShareRequest,
  type SafetyShareUpdateRequest,
  type QuestParams,
  type WeeklyGoalRequest,
  type VisibilityRequest,
  type RegisterRequest,
  type RefreshRequest
} from '@runsphere/contracts';
import { sha256, withTransaction, type Database } from '@runsphere/db';
import Fastify, { type FastifyBaseLogger, type FastifyRequest } from 'fastify';
import { chunkHash } from './activity.js';
import { registerGamificationRoutes } from './gamification-routes.js';
import { registerAccountLifecycleRoutes } from './account-routes.js';
import { registerProgressionRoutes } from './progression-routes.js';
import { registerAchievementRoutes } from './achievement-routes.js';
import { registerChallengeRoutes } from './challenge-routes.js';
import { registerClubRoutes } from './club-routes.js';
import { registerGlobalBoardRoutes } from './global-board-routes.js';
import { registerCompetitionRoutes } from './competition-routes.js';
import { registerModerationRoutes } from './moderation-routes.js';
import { registerCampaignRoutes } from './campaign-routes.js';
import { registerGovernanceRoutes } from './governance-routes.js';
import { registerTerritoryRoutes } from './territory-routes.js';
import { loadRestrictions } from './sanction-guard.js';
import {
  hashPassword,
  issueSession,
  revokeSession,
  rotateSession,
  verifyAccessToken,
  verifyPassword
} from './auth.js';

type RuntimeApiConfig = Pick<ApiConfig, 'allowedOrigins' | 'staffReviewAccountIds'> & {
  metricsCollectorToken: string | undefined;
};
const defaultApiConfig: RuntimeApiConfig = {
  allowedOrigins: ['http://localhost:4173'],
  staffReviewAccountIds: [],
  metricsCollectorToken: undefined
};
const configuredApiConfig = (config: BuildAppOptions['config']): RuntimeApiConfig => ({
  allowedOrigins: config?.allowedOrigins ?? defaultApiConfig.allowedOrigins,
  staffReviewAccountIds: config?.staffReviewAccountIds ?? defaultApiConfig.staffReviewAccountIds,
  metricsCollectorToken: config?.metricsCollectorToken ?? defaultApiConfig.metricsCollectorToken
});
const genericAuthError = { message: 'Invalid email or password' };
const rawTraceRetentionInterval = '30 days';
const privacyZoneRadiusMeters = 200;
const safetyShareDelayMinutes = 15;
const safetyShareTileSizeMeters = 500;
const emailVerificationLifetime = '24 hours';
const audit = async (
  database: Database,
  accountId: string,
  eventType: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {}
) =>
  database.query(
    `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id, metadata)
     VALUES ($1, $1, $2, $3, $4, $5)`,
    [accountId, eventType, resourceType, resourceId ?? null, JSON.stringify(metadata)]
  );
export const coarseTile = (latitude: number, longitude: number) => ({
  // Equirectangular tiles deliberately avoid H3 and retain no precise source coordinate.
  x: Math.floor(
    (longitude * 111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01)) /
      safetyShareTileSizeMeters
  ),
  y: Math.floor((latitude * 110_574) / safetyShareTileSizeMeters)
});
type ActivityState = 'received' | 'validating' | 'accepted' | 'rejected' | 'derived' | 'deleted';
type ActivityRow = {
  id: string;
  status: ActivityState;
  summary: unknown;
  rejection_reason: string | null;
  validation_errors: unknown;
  expected_chunk_count: number | null;
  movement_type?: 'walk' | 'run' | 'hike';
  created_at?: Date | string;
};
const validationErrors = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const missingSequences = async (
  database: Database,
  activityId: string,
  expectedChunkCount: number | null
): Promise<number[] | undefined> => {
  if (!expectedChunkCount) return undefined;
  const result = await database.query<{ sequence: number }>(
    `SELECT sequence FROM generate_series(0, $2 - 1) AS expected(sequence)
     WHERE NOT EXISTS (SELECT 1 FROM activity_chunks WHERE activity_id = $1 AND sequence = expected.sequence)
     ORDER BY sequence`,
    [activityId, expectedChunkCount]
  );
  return result.rows.map((row) => Number(row.sequence));
};
const statusResponse = async (database: Database, row: ActivityRow) => {
  const missing =
    row.status === 'received'
      ? await missingSequences(database, row.id, row.expected_chunk_count)
      : undefined;
  return {
    id: row.id,
    status: row.status,
    ...(row.movement_type ? { movementType: row.movement_type } : {}),
    ...(row.created_at ? { createdAt: new Date(row.created_at).toISOString() } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
    ...(validationErrors(row.validation_errors).length
      ? { validationErrors: validationErrors(row.validation_errors) }
      : {}),
    ...(missing ? { missingSequences: missing } : {})
  };
};
const weeklyGoalResponse = async (database: Database, accountId: string) => {
  const result = await database.query<{
    active_minutes_goal: number | null;
    distance_meters_goal: number | null;
    active_minutes: string;
    distance_meters: string;
    week_starts_on: string;
  }>(
    `SELECT goal.active_minutes_goal, goal.distance_meters_goal,
       coalesce(sum(output.active_duration_seconds) FILTER (WHERE submission.processed_at >= date_trunc('week', now())), 0)::text AS active_minutes,
       coalesce(sum(output.distance_meters) FILTER (WHERE submission.processed_at >= date_trunc('week', now())), 0)::text AS distance_meters,
       to_char(date_trunc('week', now())::date, 'YYYY-MM-DD') AS week_starts_on
     FROM (SELECT $1::uuid AS account_id) account
     LEFT JOIN weekly_activity_goals goal ON goal.account_id = account.account_id
     LEFT JOIN activity_submissions submission ON submission.account_id = account.account_id
       AND submission.status = 'derived' AND submission.deleted_at IS NULL
     LEFT JOIN activity_validation_outputs output ON output.activity_id = submission.id
     GROUP BY goal.active_minutes_goal, goal.distance_meters_goal`,
    [accountId]
  );
  const row = result.rows[0]!;
  return {
    weekStartsOn: row.week_starts_on,
    activeMinutes: {
      ...(row.active_minutes_goal ? { goal: Number(row.active_minutes_goal) } : {}),
      actual: Math.floor(Number(row.active_minutes) / 60)
    },
    distanceMeters: {
      ...(row.distance_meters_goal ? { goal: Number(row.distance_meters_goal) } : {}),
      actual: Math.round(Number(row.distance_meters))
    }
  };
};

export const pinoRedactionPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'cookie',
  'token',
  'refreshToken',
  'password'
] as const;

export interface BuildAppOptions {
  config?: Partial<
    Pick<ApiConfig, 'allowedOrigins' | 'staffReviewAccountIds' | 'metricsCollectorToken'>
  >;
  loggerInstance?: FastifyBaseLogger;
  db?: Database;
  authSecret?: string;
  allowInsecureAuthSecret?: boolean;
}

const assertAuthSecret = (secret: string, allowed: boolean) => {
  if (!allowed && (secret.length < 32 || secret === 'development-secret-not-for-production')) {
    throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters outside tests.');
  }
};
const authRateLimit = new Map<string, { attempts: number; resetAt: number }>();
const allowAuthAttempt = (key: string) => {
  const now = Date.now();
  const current = authRateLimit.get(key);
  if (!current || current.resetAt <= now) {
    authRateLimit.set(key, { attempts: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.attempts >= 10) return false;
  current.attempts += 1;
  return true;
};
const accountIdFrom = (request: FastifyRequest, secret: string) => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? verifyAccessToken(value.slice(7), secret) : undefined;
};
const requireAccount = (
  request: FastifyRequest,
  reply: { code(status: number): { send(value: unknown): unknown } },
  secret: string
) => {
  const accountId = accountIdFrom(request, secret);
  if (!accountId) {
    reply.code(401).send({ message: 'Unauthorized' });
    return undefined;
  }
  return accountId;
};

export const buildApp = ({
  config: apiConfig,
  loggerInstance,
  db,
  authSecret = process.env.AUTH_TOKEN_SECRET ?? 'development-secret-not-for-production',
  allowInsecureAuthSecret = process.env.NODE_ENV === 'test'
}: BuildAppOptions = {}) => {
  assertAuthSecret(authSecret, allowInsecureAuthSecret);
  const config = configuredApiConfig(apiConfig);
  const database = db;
  const metrics = createMetrics();
  const app = loggerInstance
    ? Fastify({ loggerInstance })
    : Fastify({
        logger: {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: { paths: [...pinoRedactionPaths], censor: '[REDACTED]' }
        }
      });
  app.addHook('onResponse', async (_request, reply) => {
    metrics.recordResponse(reply.statusCode);
  });
  void app.register(cors, {
    origin(origin, callback) {
      callback(null, origin !== undefined && config.allowedOrigins.includes(origin));
    }
  });
  void app.register(swagger, {
    openapi: {
      info: { title: 'RunSphere API', version: '0.1.0' },
      tags: [
        { name: 'system', description: 'Service health' },
        { name: 'auth', description: 'Adult account authentication' },
        { name: 'activities', description: 'Private activity ingestion' },
        { name: 'staff', description: 'Authenticated, audited staff review' }
      ]
    }
  });

  app.register((routes, _options, done) => {
    routes.get(
      '/health',
      { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } },
      async () => ({
        status: 'ok' as const,
        service: 'api' as const,
        timestamp: new Date().toISOString()
      })
    );
    routes.get(
      '/ready',
      {
        schema: {
          tags: ['system'],
          response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema }
        }
      },
      async (_request, reply) => {
        if (!database) return reply.code(503).send({ status: 'not_ready', service: 'api' });
        try {
          await database.query('SELECT 1');
          return { status: 'ready' as const, service: 'api' as const };
        } catch {
          return reply.code(503).send({ status: 'not_ready', service: 'api' });
        }
      }
    );
    routes.get('/metrics', async (request, reply) => {
      const token = config.metricsCollectorToken;
      if (!token) return reply.code(404).send({ message: 'Not found' });
      if (request.headers.authorization !== `Bearer ${token}`)
        return reply.code(401).send({ message: 'Unauthorized' });
      return reply
        .type('text/plain; version=0.0.4; charset=utf-8')
        .send(metrics.renderPrometheus('api'));
    });
    routes.get(
      '/v1/staff/activity-review-queue',
      {
        schema: {
          tags: ['staff'],
          headers: StaffReviewAuthorizationHeadersSchema,
          response: {
            200: StaffReviewQueueResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        if (!config.staffReviewAccountIds.includes(accountId))
          return reply.code(403).send({ message: 'Staff access required' });
        const queue = await database.query<{
          id: string;
          status: Exclude<ActivityState, 'deleted'>;
          created_at: Date;
          rejection_reason: string | null;
          validation_errors: unknown;
        }>(
          `SELECT id, status, created_at, rejection_reason, validation_errors
           FROM activity_submissions
           WHERE deleted_at IS NULL AND status IN ('received', 'validating', 'rejected')
           ORDER BY created_at ASC LIMIT 100`
        );
        await database.query(
          `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
           VALUES ($1, $2, $3, $4)`,
          [accountId, 'staff.activity_review_queue.read', 'activity_submission', queue.rows.length]
        );
        return {
          data: queue.rows.map((item) => ({
            id: item.id,
            status: item.status,
            submittedAt: item.created_at.toISOString(),
            ...(item.rejection_reason ? { rejectionReason: item.rejection_reason } : {}),
            validationErrors: validationErrors(item.validation_errors)
          }))
        };
      }
    );
    routes.get(
      '/v1/quests',
      {
        schema: {
          tags: ['quests'],
          response: { 200: QuestListResponseSchema, 503: ErrorResponseSchema }
        }
      },
      async (_request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const quests = await database.query<{
          id: string;
          title: string;
          distance_meters: number;
          estimated_active_minutes: number;
          accessibility: 'step-free' | 'mixed' | 'unknown';
          open_hours: unknown;
          checkpoint_count: string;
        }>(
          `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
             quest.open_hours, count(link.checkpoint_id)::text AS checkpoint_count
           FROM published_quest_versions quest
           JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
           GROUP BY quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes,
             quest.accessibility, quest.open_hours, quest.published_at
           ORDER BY quest.published_at DESC LIMIT 100`
        );
        return {
          data: quests.rows.map((quest) => ({
            id: quest.id,
            title: quest.title,
            distanceMeters: Number(quest.distance_meters),
            estimatedActiveMinutes: Number(quest.estimated_active_minutes),
            accessibility: quest.accessibility,
            openHours: quest.open_hours,
            checkpointCount: Number(quest.checkpoint_count)
          }))
        };
      }
    );
    routes.get<{ Params: QuestParams }>(
      '/v1/quests/:questId',
      {
        schema: {
          tags: ['quests'],
          params: QuestParamsSchema,
          response: {
            200: QuestDetailSchema,
            404: QuestNotFoundResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const quests = await database.query<{
          id: string;
          title: string;
          distance_meters: number;
          estimated_active_minutes: number;
          accessibility: 'step-free' | 'mixed' | 'unknown';
          open_hours: unknown;
          source_reviewed_at: Date | string;
          checkpoints: unknown;
        }>(
          `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
             quest.open_hours, quest.source_reviewed_at,
             jsonb_agg(jsonb_build_object('id', checkpoint.id, 'kind', checkpoint.checkpoint_kind,
               'title', checkpoint.title, 'geometry', ST_AsGeoJSON(checkpoint.geometry)::jsonb,
               'geometryVersion', checkpoint.geometry_version,
               'accessibility', coalesce(checkpoint.accessibility->>'level', 'unknown'),
               'openHours', checkpoint.open_hours) ORDER BY link.position) AS checkpoints
           FROM published_quest_versions quest
           JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
           JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
           WHERE quest.id = $1
           GROUP BY quest.id`,
          [request.params.questId]
        );
        const quest = quests.rows[0];
        return quest
          ? {
              id: quest.id,
              title: quest.title,
              distanceMeters: Number(quest.distance_meters),
              estimatedActiveMinutes: Number(quest.estimated_active_minutes),
              accessibility: quest.accessibility,
              openHours: quest.open_hours,
              checkpointCount: Array.isArray(quest.checkpoints) ? quest.checkpoints.length : 0,
              checkpoints: quest.checkpoints,
              sourceReviewedAt: new Date(quest.source_reviewed_at).toISOString()
            }
          : reply.code(404).send({ message: 'Quest not found' });
      }
    );

    routes.put<{ Body: WeeklyGoalRequest }>(
      '/v1/goals/weekly',
      {
        schema: {
          tags: ['goals'],
          headers: ActivityAuthorizationHeadersSchema,
          body: WeeklyGoalRequestSchema,
          response: {
            200: WeeklyGoalResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        await database.query(
          `INSERT INTO weekly_activity_goals (account_id, active_minutes_goal, distance_meters_goal)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_id) DO UPDATE SET active_minutes_goal = EXCLUDED.active_minutes_goal,
             distance_meters_goal = EXCLUDED.distance_meters_goal, updated_at = now()`,
          [accountId, request.body.activeMinutes ?? null, request.body.distanceMeters ?? null]
        );
        const response = await weeklyGoalResponse(database, accountId);
        return response;
      }
    );
    routes.get(
      '/v1/goals/weekly',
      {
        schema: {
          tags: ['goals'],
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: WeeklyGoalResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        return weeklyGoalResponse(database, accountId);
      }
    );

    routes.post<{ Body: RegisterRequest }>(
      '/v1/auth/register',
      {
        schema: {
          tags: ['auth'],
          body: RegisterRequestSchema,
          response: { 201: AuthResponseSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        if (!allowAuthAttempt(`register:${request.ip}`))
          return reply.code(429).send({ message: 'Too many attempts' });
        try {
          const account = await database.query<{ id: string }>(
            'INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version) VALUES ($1, $2, now(), $3) RETURNING id',
            [
              request.body.email.trim().toLowerCase(),
              await hashPassword(request.body.password),
              request.body.policyVersion
            ]
          );
          const id = account.rows[0]!.id;
          await database.query(
            'INSERT INTO consent_history (account_id, consent_type, granted, policy_version) VALUES ($1, $2, true, $3)',
            [id, 'age_assertion', request.body.policyVersion]
          );
          return reply.code(201).send(await issueSession(database, id, authSecret));
        } catch (error) {
          if ((error as { code?: string }).code === '23505')
            return reply.code(409).send({ message: 'Account could not be created' });
          throw error;
        }
      }
    );
    routes.post(
      '/v1/account/email-verification',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            202: EmailVerificationRequestResponseSchema,
            401: ErrorResponseSchema,
            429: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        if (!allowAuthAttempt(`email-verification:${accountId}`))
          return reply.code(429).send({ message: 'Too many attempts' });
        const verification = await database.query<{ token: string }>(
          `INSERT INTO email_verification_tokens (account_id, token_hash, expires_at)
           SELECT id, encode(digest($2, 'sha256'), 'hex'), now() + $3::interval
           FROM accounts WHERE id = $1 AND deleted_at IS NULL
           RETURNING $2 AS token`,
          [accountId, randomBytes(32).toString('base64url'), emailVerificationLifetime]
        );
        if (!verification.rows[0]) return reply.code(401).send({ message: 'Unauthorized' });
        // The delivery provider consumes this opaque token; it is deliberately not included in API responses.
        await audit(database, accountId, 'email_verification.requested', 'account', accountId);
        return reply.code(202).send({ status: 'requested' });
      }
    );
    routes.post<{ Body: EmailVerificationCompleteRequest }>(
      '/v1/account/email-verification/complete',
      {
        schema: {
          body: EmailVerificationCompleteRequestSchema,
          response: { 204: { type: 'null' }, 400: ErrorResponseSchema, 503: ErrorResponseSchema }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const completed = await database.query<{ account_id: string }>(
          `UPDATE email_verification_tokens token SET consumed_at = now()
           FROM accounts account
           WHERE token.account_id = account.id AND token.token_hash = encode(digest($1, 'sha256'), 'hex')
             AND token.consumed_at IS NULL AND token.expires_at > now() AND account.deleted_at IS NULL
           RETURNING token.account_id`,
          [request.body.token]
        );
        const accountId = completed.rows[0]?.account_id;
        if (!accountId)
          return reply.code(400).send({ message: 'Invalid or expired verification token' });
        await database.query(
          `UPDATE accounts SET email_verified_at = now(), email_verification_status = 'verified',
             trust_established_at = coalesce(trust_established_at, now()), updated_at = now()
           WHERE id = $1`,
          [accountId]
        );
        await audit(database, accountId, 'email_verification.completed', 'account', accountId);
        return reply.code(204).send();
      }
    );
    routes.post<{ Body: LoginRequest }>(
      '/v1/auth/login',
      {
        schema: {
          tags: ['auth'],
          body: LoginRequestSchema,
          response: {
            200: AuthResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        if (!allowAuthAttempt(`login:${request.ip}:${request.body.email.toLowerCase()}`))
          return reply.code(429).send({ message: 'Too many attempts' });
        const accounts = await database.query<{ id: string; password_hash: string }>(
          'SELECT id, password_hash FROM accounts WHERE lower(email) = lower($1)',
          [request.body.email.trim()]
        );
        if (
          !accounts.rows[0] ||
          !(await verifyPassword(accounts.rows[0].password_hash, request.body.password))
        )
          return reply.code(401).send(genericAuthError);
        // A suspended account is told why, and only after its password checked
        // out: answering before that would turn sign-in into a way to test
        // whether somebody else has been suspended.
        const restrictions = await loadRestrictions(database, accounts.rows[0].id);
        if (restrictions.signInBlocked)
          return reply.code(403).send({
            message:
              restrictions.statement ??
              'This account is suspended. Contact support if you believe that is wrong.'
          });
        return issueSession(database, accounts.rows[0].id, authSecret);
      }
    );
    routes.post<{ Body: RefreshRequest }>(
      '/v1/auth/refresh',
      {
        schema: {
          tags: ['auth'],
          body: RefreshRequestSchema,
          response: {
            200: AuthResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const session = await rotateSession(database, request.body.refreshToken, authSecret);
        if (!session) return reply.code(401).send({ message: 'Invalid refresh token' });
        // Refresh is checked too, so a suspension applied mid-session takes
        // effect at the next rotation rather than waiting for a sign-out. The
        // account is read back out of the token just minted rather than
        // widening `rotateSession`'s return shape for one caller.
        const rotatedAccountId = verifyAccessToken(session.accessToken, authSecret);
        const refreshed = rotatedAccountId
          ? await loadRestrictions(database, rotatedAccountId)
          : { sharingPaused: false, signInBlocked: false, statement: undefined };
        if (refreshed.signInBlocked) {
          await revokeSession(database, request.body.refreshToken);
          return reply.code(403).send({
            message:
              refreshed.statement ??
              'This account is suspended. Contact support if you believe that is wrong.'
          });
        }
        return session;
      }
    );
    routes.post<{ Body: RefreshRequest }>(
      '/v1/auth/logout',
      {
        schema: {
          tags: ['auth'],
          body: RefreshRequestSchema,
          response: { 204: { type: 'null' }, 503: ErrorResponseSchema }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        await revokeSession(database, request.body.refreshToken);
        return reply.code(204).send();
      }
    );

    routes.post<{ Body: PrivacyZoneRequest }>(
      '/v1/privacy-zones',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          body: PrivacyZoneRequestSchema,
          response: {
            201: PrivacyZoneResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const { latitude, longitude } = request.body.center;
        const result = await database.query<{ id: string; geometry_version: number }>(
          `INSERT INTO privacy_zones (account_id, name, center, radius_meters, geometry)
           VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5,
             ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $6::double precision)::geometry)
           RETURNING id, geometry_version`,
          [
            accountId,
            request.body.name,
            longitude,
            latitude,
            privacyZoneRadiusMeters,
            privacyZoneRadiusMeters
          ]
        );
        await audit(
          database,
          accountId,
          'privacy_zone.created',
          'privacy_zone',
          result.rows[0]!.id
        );
        return reply.code(201).send({
          id: result.rows[0]!.id,
          name: request.body.name,
          center: request.body.center,
          radiusMeters: privacyZoneRadiusMeters,
          geometryVersion: result.rows[0]!.geometry_version
        });
      }
    );

    routes.put<{ Body: VisibilityRequest }>(
      '/v1/account/visibility',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          body: VisibilityRequestSchema,
          response: {
            200: VisibilityResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const visibility = await database.query<{ id: string }>(
          `UPDATE accounts SET profile_visibility = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL
             AND ($2 = 'private' OR email_verification_status = 'verified')
           RETURNING id`,
          [accountId, request.body.activityVisibility]
        );
        if (!visibility.rows[0])
          return reply
            .code(403)
            .send({ message: 'A verified account is required for follower visibility' });
        await audit(database, accountId, 'visibility.updated', 'account', accountId, {
          activityVisibility: request.body.activityVisibility
        });
        return { activityVisibility: request.body.activityVisibility };
      }
    );

    routes.get(
      '/v1/safety-contacts',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: SafetyContactListResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const contacts = await database.query<{
          id: string;
          email: string;
          status: 'pending' | 'accepted';
        }>(
          `SELECT id, email, status FROM safety_contacts
           WHERE account_id = $1 AND status <> 'revoked' ORDER BY created_at DESC`,
          [accountId]
        );
        return { data: contacts.rows };
      }
    );

    routes.post<{ Body: SafetyContactRequest }>(
      '/v1/safety-contacts',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          body: SafetyContactRequestSchema,
          response: {
            201: SafetyContactResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            409: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const email = request.body.email.trim().toLowerCase();
        const eligible = await database.query<{ id: string }>(
          `SELECT contact.id FROM accounts owner CROSS JOIN accounts contact
           WHERE owner.id = $1 AND lower(contact.email) = lower($2) AND contact.id <> owner.id
             AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
             AND contact.email_verified_at IS NOT NULL AND contact.trust_established_at IS NOT NULL
             AND owner.deleted_at IS NULL AND contact.deleted_at IS NULL`,
          [accountId, email]
        );
        if (!eligible.rows[0])
          return reply
            .code(403)
            .send({ message: 'Verified, trusted accounts are required for safety invitations' });
        try {
          const contact = await database.query<{ id: string; email: string; status: 'pending' }>(
            `INSERT INTO safety_contacts (account_id, email) VALUES ($1, $2)
             RETURNING id, email, status`,
            [accountId, email]
          );
          await audit(
            database,
            accountId,
            'safety_contact.invited',
            'safety_contact',
            contact.rows[0]!.id
          );
          return reply.code(201).send(contact.rows[0]!);
        } catch (error) {
          if ((error as { code?: string }).code === '23505')
            return reply.code(409).send({ message: 'Safety contact already exists' });
          throw error;
        }
      }
    );

    routes.post<{ Params: { safetyContactId: string } }>(
      '/v1/safety-contacts/:safetyContactId/accept',
      {
        schema: {
          params: SafetyContactParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: SafetyContactAcceptResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const accepted = await database.query<{ id: string }>(
          `UPDATE safety_contacts safety_contact SET status = 'accepted', accepted_at = now(), updated_at = now()
           FROM accounts contact, accounts owner
           WHERE safety_contact.id = $1 AND lower(safety_contact.email) = lower(contact.email)
             AND contact.id = $2 AND owner.id = safety_contact.account_id
             AND safety_contact.status = 'pending' AND contact.email_verified_at IS NOT NULL
             AND contact.trust_established_at IS NOT NULL AND contact.deleted_at IS NULL
             AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
             AND owner.deleted_at IS NULL
           RETURNING safety_contact.id`,
          [request.params.safetyContactId, accountId]
        );
        if (accepted.rows[0]) {
          await audit(
            database,
            accountId,
            'safety_contact.accepted',
            'safety_contact',
            accepted.rows[0].id
          );
          return { status: 'accepted' as const };
        }
        const existing = await database.query<{ id: string }>(
          'SELECT id FROM safety_contacts WHERE id = $1',
          [request.params.safetyContactId]
        );
        return existing.rows[0]
          ? reply.code(403).send({ message: 'Safety contact cannot be accepted' })
          : reply.code(404).send({ message: 'Safety contact not found' });
      }
    );

    routes.post<{ Body: SafetyShareRequest }>(
      '/v1/safety-shares',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          body: SafetyShareRequestSchema,
          response: {
            201: SafetyShareResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const contact = await database.query<{ id: string }>(
          `SELECT safety_contact.id
           FROM safety_contacts safety_contact
           JOIN accounts owner ON owner.id = safety_contact.account_id
           JOIN accounts contact ON lower(contact.email) = lower(safety_contact.email)
           WHERE safety_contact.id = $1 AND safety_contact.account_id = $2 AND safety_contact.status = 'accepted'
             AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
             AND contact.email_verified_at IS NOT NULL AND contact.trust_established_at IS NOT NULL
             AND owner.deleted_at IS NULL AND contact.deleted_at IS NULL`,
          [request.body.safetyContactId, accountId]
        );
        if (!contact.rows[0])
          return reply
            .code(403)
            .send({ message: 'An accepted, verified safety contact is required' });
        if (request.body.activityId) {
          const activity = await database.query<{ id: string }>(
            `SELECT id FROM activity_submissions
             WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
            [request.body.activityId, accountId]
          );
          if (!activity.rows[0])
            return reply.code(403).send({ message: 'Activity not available for sharing' });
        }
        const share = await database.query<{
          id: string;
          safety_contact_id: string;
          status: 'active';
          expires_at: Date;
        }>(
          `INSERT INTO safety_share_sessions
             (account_id, safety_contact_id, activity_id, delay_minutes, tile_size_meters, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + ($6::text || ' minutes')::interval)
           RETURNING id, safety_contact_id, status, expires_at`,
          [
            accountId,
            request.body.safetyContactId,
            request.body.activityId ?? null,
            safetyShareDelayMinutes,
            safetyShareTileSizeMeters,
            request.body.durationMinutes
          ]
        );
        await audit(database, accountId, 'safety_share.started', 'safety_share', share.rows[0]!.id);
        return reply.code(201).send({
          id: share.rows[0]!.id,
          safetyContactId: share.rows[0]!.safety_contact_id,
          status: share.rows[0]!.status,
          delayMinutes: safetyShareDelayMinutes,
          tileSizeMeters: safetyShareTileSizeMeters,
          expiresAt: new Date(share.rows[0]!.expires_at).toISOString()
        });
      }
    );

    routes.post<{ Params: { shareId: string }; Body: SafetyShareUpdateRequest }>(
      '/v1/safety-shares/:shareId/updates',
      {
        schema: {
          params: SafetyShareParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          body: SafetyShareUpdateRequestSchema,
          response: {
            204: { type: 'null' },
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const tile = coarseTile(request.body.latitude, request.body.longitude);
        const saved = await database.query<{ id: string }>(
          `INSERT INTO safety_share_updates (share_session_id, tile_x, tile_y, observed_at, available_at)
           SELECT id, $3, $4, least($5::timestamptz, now()), now() + interval '15 minutes'
           FROM safety_share_sessions
           WHERE id = $1 AND account_id = $2 AND status = 'active' AND expires_at > now()
           ON CONFLICT (share_session_id, observed_at) DO NOTHING RETURNING id`,
          [request.params.shareId, accountId, tile.x, tile.y, request.body.observedAt]
        );
        return saved.rows[0]
          ? reply.code(204).send()
          : reply.code(404).send({ message: 'Active safety share not found' });
      }
    );

    routes.get<{ Params: { shareId: string } }>(
      '/v1/safety-shares/:shareId/updates',
      {
        schema: {
          params: SafetyShareParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: SafetyShareReadResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const share = await database.query<{
          status: 'active' | 'revoked' | 'expired';
          delay_minutes: number;
          tile_size_meters: number;
        }>(
          `SELECT session.status, session.delay_minutes, session.tile_size_meters
           FROM safety_share_sessions session
           JOIN safety_contacts contact ON contact.id = session.safety_contact_id
           JOIN accounts recipient ON lower(recipient.email) = lower(contact.email)
           WHERE session.id = $1 AND recipient.id = $2 AND contact.status = 'accepted'
             AND recipient.email_verified_at IS NOT NULL AND recipient.trust_established_at IS NOT NULL
             AND recipient.deleted_at IS NULL`,
          [request.params.shareId, accountId]
        );
        const session = share.rows[0];
        if (!session) return reply.code(404).send({ message: 'Safety share not found' });
        if (session.status !== 'active')
          return reply.code(403).send({ message: 'Safety share is not active' });
        const updates = await database.query<{
          tile_x: number;
          tile_y: number;
          observed_at: Date;
        }>(
          `SELECT tile_x, tile_y, observed_at FROM safety_share_updates
           WHERE share_session_id = $1 AND available_at <= now()
           ORDER BY observed_at DESC LIMIT 100`,
          [request.params.shareId]
        );
        return {
          status: session.status,
          delayMinutes: safetyShareDelayMinutes,
          tileSizeMeters: safetyShareTileSizeMeters,
          updates: updates.rows.map((update) => ({
            tileX: update.tile_x,
            tileY: update.tile_y,
            observedAt: new Date(update.observed_at).toISOString()
          }))
        };
      }
    );

    routes.delete<{ Params: { shareId: string } }>(
      '/v1/safety-shares/:shareId',
      {
        schema: {
          params: SafetyShareParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            204: { type: 'null' },
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const revoked = await database.query<{ id: string }>(
          `UPDATE safety_share_sessions SET status = 'revoked', revoked_at = now()
           WHERE id = $1 AND account_id = $2 AND status = 'active' RETURNING id`,
          [request.params.shareId, accountId]
        );
        if (!revoked.rows[0])
          return reply.code(404).send({ message: 'Active safety share not found' });
        await audit(
          database,
          accountId,
          'safety_share.revoked',
          'safety_share',
          request.params.shareId
        );
        return reply.code(204).send();
      }
    );

    routes.get(
      '/v1/account/export',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: AccountExportResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const [account, zones, activities] = await Promise.all([
          database.query<{ email: string; profile_visibility: 'private' | 'followers' }>(
            'SELECT email, profile_visibility FROM accounts WHERE id = $1 AND deleted_at IS NULL',
            [accountId]
          ),
          database.query<{
            id: string;
            name: string;
            latitude: number;
            longitude: number;
            geometry_version: number;
          }>(
            `SELECT id, name, ST_Y(center) AS latitude, ST_X(center) AS longitude, geometry_version
             FROM privacy_zones WHERE account_id = $1`,
            [accountId]
          ),
          database.query<{ id: string; raw_trace_available: boolean }>(
            `SELECT id, raw_trace_retention_until > now() AND raw_trace_purged_at IS NULL AS raw_trace_available
             FROM activity_submissions WHERE account_id = $1 AND deleted_at IS NULL`,
            [accountId]
          )
        ]);
        const profile = account.rows[0];
        if (!profile) return reply.code(401).send({ message: 'Unauthorized' });
        await database.query('INSERT INTO account_export_requests (account_id) VALUES ($1)', [
          accountId
        ]);
        await audit(database, accountId, 'account_export.generated', 'account', accountId);
        return {
          status: 'ready' as const,
          generatedAt: new Date().toISOString(),
          rawTraceAvailability: 'available-within-retention-window' as const,
          data: {
            profile: {
              email: profile.email,
              activityVisibility: profile.profile_visibility
            },
            privacyZones: zones.rows.map((zone) => ({
              id: zone.id,
              name: zone.name,
              center: { latitude: Number(zone.latitude), longitude: Number(zone.longitude) },
              radiusMeters: privacyZoneRadiusMeters,
              geometryVersion: zone.geometry_version
            })),
            activities: activities.rows.map((activity) => ({
              id: activity.id,
              rawTraceAvailable: activity.raw_trace_available
            }))
          }
        };
      }
    );

    routes.delete(
      '/v1/account',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            202: AccountDeletionResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        await withTransaction(database, async (client) => {
          await client.query(
            `UPDATE accounts SET deletion_requested_at = coalesce(deletion_requested_at, now()),
             profile_visibility = 'private', updated_at = now() WHERE id = $1`,
            [accountId]
          );
          await client.query(
            `UPDATE safety_share_sessions SET status = 'revoked', revoked_at = now()
             WHERE account_id = $1 AND status = 'active'`,
            [accountId]
          );
          await client.query(
            `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id)
             VALUES ($1, $1, 'account_deletion.requested', 'account', $1)`,
            [accountId]
          );
        });
        return reply.code(202).send({ status: 'scheduled' });
      }
    );

    routes.post<{ Body: ActivityCreateRequest }>(
      '/v1/activities',
      {
        schema: {
          body: ActivityCreateRequestSchema,
          headers: ActivityCreateHeadersSchema,
          response: {
            201: ActivityCreateResponseSchema,
            200: ActivityCreateResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const key = request.headers['idempotency-key']!;
        const fingerprint = sha256(JSON.stringify({ movementType: request.body.movementType }));
        const insert = await database.query<{ id: string; status: 'received' }>(
          `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, request_fingerprint)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id, status`,
          [accountId, key, request.body.movementType, fingerprint]
        );
        if (insert.rows[0]) return reply.code(201).send(insert.rows[0]);
        const current = await database.query<{
          id: string;
          status: 'received';
          request_fingerprint: string;
        }>(
          'SELECT id, status, request_fingerprint FROM activity_submissions WHERE account_id = $1 AND idempotency_key = $2',
          [accountId, key]
        );
        if (!current.rows[0] || current.rows[0].request_fingerprint !== fingerprint) {
          return reply
            .code(409)
            .send({ message: 'Idempotency key was used with a different request' });
        }
        return reply.code(200).send(current.rows[0]);
      }
    );

    routes.put<{ Params: { activityId: string }; Body: ActivityChunkRequest }>(
      '/v1/activities/:activityId/chunks',
      {
        schema: {
          params: ActivityParamsSchema,
          headers: ActivityChunkHeadersSchema,
          body: ActivityChunkRequestSchema,
          response: {
            204: ActivityChunkResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        if (request.headers['content-encoding'] === 'gzip')
          return reply.code(400).send({ message: 'Compressed chunks are not supported' });
        const serialized = JSON.stringify(request.body);
        if (Buffer.byteLength(serialized) > 1_048_576)
          return reply.code(400).send({ message: 'Chunk exceeds the 1 MiB limit' });
        const checksum = chunkHash(request.body);
        if (request.headers['x-chunk-checksum'] !== checksum)
          return reply.code(400).send({ message: 'Chunk checksum does not match payload' });
        const activity = await database.query<{ id: string }>(
          'SELECT id FROM activity_submissions WHERE id = $1 AND account_id = $2 AND status = $3 AND deleted_at IS NULL',
          [request.params.activityId, accountId, 'received']
        );
        if (!activity.rows[0]) return reply.code(404).send({ message: 'Activity not found' });
        try {
          await database.query(
            `INSERT INTO activity_chunks (activity_id, sequence, payload, payload_hash, encoding, compressed_bytes, uncompressed_bytes)
             VALUES ($1, $2, $3, $4, 'identity', $5, $5)`,
            [
              activity.rows[0].id,
              request.body.sequence,
              serialized,
              checksum,
              Buffer.byteLength(serialized)
            ]
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') {
            const prior = await database.query<{ payload_hash: string }>(
              'SELECT payload_hash FROM activity_chunks WHERE activity_id = $1 AND sequence = $2',
              [request.params.activityId, request.body.sequence]
            );
            if (prior.rows[0]?.payload_hash === checksum) return reply.code(204).send();
            return reply.code(409).send({ message: 'Chunk sequence conflicts with prior payload' });
          }
          throw error;
        }
        return reply.code(204).send();
      }
    );

    routes.post<{ Params: { activityId: string }; Body: ActivityFinalizeRequest }>(
      '/v1/activities/:activityId/finalize',
      {
        schema: {
          params: ActivityParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          body: ActivityFinalizeRequestSchema,
          response: {
            202: ActivityFinalizeResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const activity = await withTransaction(database, async (client) => {
          const owned = await client.query<
            ActivityRow & { source_checksum: string | null; finalized_checksum: string | null }
          >(
            `SELECT id, status, summary, rejection_reason, validation_errors, expected_chunk_count, source_checksum, finalized_checksum
             FROM activity_submissions WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL FOR UPDATE`,
            [request.params.activityId, accountId]
          );
          const current = owned.rows[0];
          if (!current) return undefined;
          if (current.status !== 'received') {
            if (
              current.expected_chunk_count === request.body.expectedChunkCount &&
              current.finalized_checksum === request.body.checksum
            )
              return current;
            return 'conflict' as const;
          }
          const chunks = await client.query<{
            count: string;
            payload_hashes: string[];
            minimum: number | null;
            maximum: number | null;
          }>(
            `SELECT count(*)::text AS count, coalesce(array_agg(payload_hash ORDER BY sequence), ARRAY[]::text[]) AS payload_hashes,
              min(sequence) AS minimum, max(sequence) AS maximum FROM activity_chunks WHERE activity_id = $1`,
            [request.params.activityId]
          );
          const aggregateChecksum = sha256(
            activityFinalizeChecksumInput(
              chunks.rows[0]!.payload_hashes.map((checksum, sequence) => ({ sequence, checksum }))
            )
          );
          const ordered =
            Number(chunks.rows[0]?.count) === request.body.expectedChunkCount &&
            chunks.rows[0]?.minimum === 0 &&
            chunks.rows[0]?.maximum === request.body.expectedChunkCount - 1;
          if (!ordered || aggregateChecksum !== request.body.checksum) {
            const errors = [
              ...(ordered ? [] : ['Missing or non-contiguous chunks']),
              ...(aggregateChecksum === request.body.checksum
                ? []
                : ['Finalize checksum does not match chunks'])
            ];
            await client.query(
              'UPDATE activity_submissions SET expected_chunk_count = $2, validation_errors = $3 WHERE id = $1',
              [request.params.activityId, request.body.expectedChunkCount, JSON.stringify(errors)]
            );
            return null;
          }
          const updated = await client.query<ActivityRow>(
            `UPDATE activity_submissions
             SET status = 'validating', finalized_at = now(), source_checksum = $2, finalized_checksum = $3,
               expected_chunk_count = $4, validation_errors = '[]'::jsonb, raw_trace_checksum = $2,
               raw_trace_retention_until = now() + $5::interval
             WHERE id = $1 RETURNING id, status, summary, rejection_reason, validation_errors, expected_chunk_count`,
            [
              request.params.activityId,
              aggregateChecksum,
              request.body.checksum,
              request.body.expectedChunkCount,
              rawTraceRetentionInterval
            ]
          );
          await client.query(
            `INSERT INTO outbox_events (topic, aggregate_id, payload) VALUES ($1, $2, $3)
             ON CONFLICT (topic, aggregate_id) WHERE topic = 'activity.finalized' DO NOTHING`,
            [
              'activity.finalized',
              updated.rows[0]!.id,
              JSON.stringify({ activityId: updated.rows[0]!.id })
            ]
          );
          return updated.rows[0]!;
        });
        if (activity === undefined) return reply.code(404).send({ message: 'Activity not found' });
        if (activity === 'conflict')
          return reply
            .code(409)
            .send({ message: 'Finalize request conflicts with activity state' });
        if (activity === null)
          return reply
            .code(400)
            .send({ message: 'Activity has missing chunks or a checksum mismatch' });
        return reply.code(202).send(await statusResponse(database, activity));
      }
    );

    routes.get<{ Params: { activityId: string }; Querystring: { expectedChunkCount: number } }>(
      '/v1/activities/:activityId/sync',
      {
        schema: {
          params: ActivityParamsSchema,
          querystring: ActivitySyncQuerySchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: ActivitySyncStatusResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const result = await database.query<ActivityRow>(
          `SELECT id, status, summary, rejection_reason, validation_errors, expected_chunk_count
           FROM activity_submissions WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
          [request.params.activityId, accountId]
        );
        const row = result.rows[0];
        if (!row) return reply.code(404).send({ message: 'Activity not found' });
        const missing = await missingSequences(database, row.id, request.query.expectedChunkCount);
        return {
          ...(await statusResponse(database, row)),
          ...(row.status === 'received' ? { missingSequences: missing } : {})
        };
      }
    );

    routes.get(
      '/v1/activities',
      {
        schema: {
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: ActivityListResponseSchema,
            401: ErrorResponseSchema,
            503: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const activities = await database.query<ActivityRow>(
          `SELECT id, status, summary, rejection_reason, validation_errors, expected_chunk_count, movement_type, created_at
           FROM activity_submissions WHERE account_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
          [accountId]
        );
        return {
          data: await Promise.all(activities.rows.map((row) => statusResponse(database, row)))
        };
      }
    );

    routes.get<{ Params: { activityId: string } }>(
      '/v1/activities/:activityId',
      {
        schema: {
          params: ActivityParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            200: ActivityDetailResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const result = await database.query<
          ActivityRow & {
            route: unknown;
            policy_version: string | null;
            algorithm_version: string | null;
            removed_point_count: number | null;
            outcome: string | null;
          }
        >(
          `SELECT submission.id, submission.status, submission.summary, submission.rejection_reason,
             submission.validation_errors, submission.expected_chunk_count, submission.movement_type, submission.created_at,
             ST_AsGeoJSON(derivation.shareable_route)::jsonb AS route, derivation.policy_version,
             derivation.algorithm_version, derivation.removed_point_count, derivation.outcome
           FROM activity_submissions submission LEFT JOIN activity_derivations derivation ON derivation.activity_id = submission.id
           WHERE submission.id = $1 AND submission.account_id = $2 AND submission.deleted_at IS NULL`,
          [request.params.activityId, accountId]
        );
        if (!result.rows[0]) return reply.code(404).send({ message: 'Activity not found' });
        const row = result.rows[0];
        return {
          ...(await statusResponse(database, row)),
          ...(row.status === 'derived'
            ? {
                geometry: row.route ?? null,
                provenance: {
                  policyVersion: row.policy_version!,
                  algorithmVersion: row.algorithm_version!,
                  removedPointCount: row.removed_point_count!,
                  outcome: row.outcome!
                }
              }
            : {})
        };
      }
    );

    routes.delete<{ Params: { activityId: string } }>(
      '/v1/activities/:activityId',
      {
        schema: {
          params: ActivityParamsSchema,
          headers: ActivityAuthorizationHeadersSchema,
          response: {
            204: ActivityDeleteResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const deleted = await withTransaction(database, async (client) => {
          const result = await client.query<{ id: string }>(
            `UPDATE activity_submissions SET status = 'deleted', deleted_at = coalesce(deleted_at, now()),
             summary = NULL, rejection_reason = NULL, validation_errors = '[]'::jsonb,
             raw_trace_purged_at = coalesce(raw_trace_purged_at, now())
             WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL RETURNING id`,
            [request.params.activityId, accountId]
          );
          if (!result.rows[0]) return false;
          await client.query('DELETE FROM activity_chunks WHERE activity_id = $1', [
            request.params.activityId
          ]);
          await client.query('DELETE FROM activity_derivations WHERE activity_id = $1', [
            request.params.activityId
          ]);
          await client.query(
            'UPDATE outbox_events SET processed_at = now(), last_error = $2 WHERE aggregate_id = $1 AND processed_at IS NULL',
            [request.params.activityId, 'activity deleted']
          );
          return true;
        });
        return deleted
          ? reply.code(204).send()
          : reply.code(404).send({ message: 'Activity not found' });
      }
    );

    registerGamificationRoutes({ routes, database, authSecret });
    registerAccountLifecycleRoutes({ routes, database, authSecret });
    registerProgressionRoutes({ routes, database, authSecret });
    registerAchievementRoutes({ routes, database, authSecret });
    registerChallengeRoutes({ routes, database, authSecret });
    registerClubRoutes({ routes, database, authSecret });
    registerGlobalBoardRoutes({ routes, database, authSecret });
    registerCompetitionRoutes({ routes, database, authSecret });
    registerModerationRoutes({ routes, database, authSecret });
    registerCampaignRoutes({ routes, database, authSecret });
    registerGovernanceRoutes({ routes, database, authSecret });
    registerTerritoryRoutes({ routes, database, authSecret });

    done();
  });
  return app;
};
