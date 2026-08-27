import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { ApiConfig } from '@runsphere/config';
import {
  ActivityChunkRequestSchema,
  ActivityCreateRequestSchema,
  ActivityFinalizeRequestSchema,
  ActivityParamsSchema,
  ActivityStatusResponseSchema,
  AuthResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  PrivacyZoneRequestSchema,
  PrivacyZoneResponseSchema,
  QuestListResponseSchema,
  QuestNotFoundResponseSchema,
  QuestParamsSchema,
  QuestSummarySchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  type ActivityChunkRequest,
  type ActivityCreateRequest,
  type ActivityFinalizeRequest,
  type LoginRequest,
  type PrivacyZoneRequest,
  type QuestParams,
  type RegisterRequest,
  type RefreshRequest,
  type QuestSummary
} from '@runsphere/contracts';
import { sha256, withTransaction, type Database } from '@runsphere/db';
import { demoQuests, getQuestById } from '@runsphere/domain';
import Fastify, { type FastifyBaseLogger, type FastifyRequest } from 'fastify';
import { chunkHash } from './activity.js';
import {
  hashPassword,
  issueSession,
  revokeSession,
  rotateSession,
  verifyAccessToken,
  verifyPassword
} from './auth.js';

const defaultApiConfig: Pick<ApiConfig, 'allowedOrigins'> = {
  allowedOrigins: ['http://localhost:4173']
};
const genericAuthError = { message: 'Invalid email or password' };
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
  config?: Pick<ApiConfig, 'allowedOrigins'>;
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
  config = defaultApiConfig,
  loggerInstance,
  db,
  authSecret = process.env.AUTH_TOKEN_SECRET ?? 'development-secret-not-for-production',
  allowInsecureAuthSecret = process.env.NODE_ENV === 'test'
}: BuildAppOptions = {}) => {
  assertAuthSecret(authSecret, allowInsecureAuthSecret);
  const database = db;
  const app = loggerInstance
    ? Fastify({ loggerInstance })
    : Fastify({
        logger: {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: { paths: [...pinoRedactionPaths], censor: '[REDACTED]' }
        }
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
        { name: 'activities', description: 'Private activity ingestion' }
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
      '/v1/quests',
      { schema: { response: { 200: QuestListResponseSchema } } },
      async () => ({ data: demoQuests })
    );
    routes.get<{ Params: QuestParams }>(
      '/v1/quests/:questId',
      {
        schema: {
          params: QuestParamsSchema,
          response: { 200: QuestSummarySchema, 404: QuestNotFoundResponseSchema }
        }
      },
      async (request, reply): Promise<QuestSummary | { message: 'Quest not found' }> => {
        const quest = getQuestById(request.params.questId);
        return quest ?? reply.code(404).send({ message: 'Quest not found' });
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
    routes.post<{ Body: LoginRequest }>(
      '/v1/auth/login',
      {
        schema: {
          tags: ['auth'],
          body: LoginRequestSchema,
          response: { 200: AuthResponseSchema, 401: ErrorResponseSchema }
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
        return issueSession(database, accounts.rows[0].id, authSecret);
      }
    );
    routes.post<{ Body: RefreshRequest }>(
      '/v1/auth/refresh',
      {
        schema: {
          tags: ['auth'],
          body: RefreshRequestSchema,
          response: { 200: AuthResponseSchema, 401: ErrorResponseSchema }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const session = await rotateSession(database, request.body.refreshToken, authSecret);
        return session ?? reply.code(401).send({ message: 'Invalid refresh token' });
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
          body: PrivacyZoneRequestSchema,
          response: {
            201: PrivacyZoneResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const geojson = JSON.stringify(request.body.geometry);
        if (Buffer.byteLength(geojson) > 100_000)
          return reply.code(400).send({ message: 'Invalid privacy-zone geometry' });
        const valid = await database.query<{ valid: boolean }>(
          `SELECT ST_IsValid(geometry) AS valid FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geometry) zone
           WHERE ST_SRID(geometry) = 4326 AND GeometryType(geometry) IN ('POINT', 'POLYGON')`,
          [geojson]
        );
        if (!valid.rows[0]?.valid)
          return reply.code(400).send({ message: 'Invalid privacy-zone geometry' });
        const result = await database.query<{ id: string; geometry_version: number }>(
          'INSERT INTO privacy_zones (account_id, name, geometry) VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) RETURNING id, geometry_version',
          [accountId, request.body.name, geojson]
        );
        return reply.code(201).send({
          id: result.rows[0]!.id,
          name: request.body.name,
          geometry: request.body.geometry,
          geometryVersion: result.rows[0]!.geometry_version
        });
      }
    );

    routes.post<{ Body: ActivityCreateRequest }>(
      '/v1/activities',
      {
        schema: {
          body: ActivityCreateRequestSchema,
          headers: {
            type: 'object',
            required: ['idempotency-key'],
            properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } }
          },
          response: {
            201: ActivityStatusResponseSchema,
            200: ActivityStatusResponseSchema,
            401: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const key = request.headers['idempotency-key']!;
        const insert = await database.query<{ id: string; status: 'received' }>(
          'INSERT INTO activity_submissions (account_id, idempotency_key, movement_type) VALUES ($1, $2, $3) ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id, status',
          [accountId, key, request.body.movementType]
        );
        const current =
          insert.rows[0] ??
          (
            await database.query<{ id: string; status: 'received' }>(
              'SELECT id, status FROM activity_submissions WHERE account_id = $1 AND idempotency_key = $2',
              [accountId, key]
            )
          ).rows[0]!;
        return reply.code(insert.rows.length ? 201 : 200).send(current);
      }
    );

    routes.put<{ Params: { activityId: string }; Body: ActivityChunkRequest }>(
      '/v1/activities/:activityId/chunks',
      {
        schema: {
          params: ActivityParamsSchema,
          body: ActivityChunkRequestSchema,
          response: {
            204: { type: 'null' },
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
        const activity = await database.query<{ id: string }>(
          'SELECT id FROM activity_submissions WHERE id = $1 AND account_id = $2 AND status = $3',
          [request.params.activityId, accountId, 'received']
        );
        if (!activity.rows[0]) return reply.code(404).send({ message: 'Activity not found' });
        try {
          await database.query(
            'INSERT INTO activity_chunks (activity_id, sequence, payload, payload_hash) VALUES ($1, $2, $3, $4)',
            [
              activity.rows[0].id,
              request.body.sequence,
              JSON.stringify(request.body),
              chunkHash(request.body)
            ]
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505')
            return reply.code(409).send({ message: 'Chunk already received' });
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
          body: ActivityFinalizeRequestSchema,
          response: {
            202: ActivityStatusResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const activity = await withTransaction(database, async (client) => {
          const owned = await client.query<{ id: string }>(
            'SELECT id FROM activity_submissions WHERE id = $1 AND account_id = $2 AND status = $3 FOR UPDATE',
            [request.params.activityId, accountId, 'received']
          );
          if (!owned.rows[0]) return undefined;
          const chunks = await client.query<{ count: string; checksum: string }>(
            'SELECT count(*)::text AS count, coalesce(string_agg(payload_hash, $2 ORDER BY sequence), $3) AS checksum FROM activity_chunks WHERE activity_id = $1',
            [request.params.activityId, '', '']
          );
          if (Number(chunks.rows[0]?.count) !== request.body.expectedChunkCount) return null;
          const updated = await client.query<{ id: string; status: 'validating' }>(
            'UPDATE activity_submissions SET status = $1, finalized_at = now(), source_checksum = $2 WHERE id = $3 RETURNING id, status',
            ['validating', sha256(chunks.rows[0]!.checksum), request.params.activityId]
          );
          await client.query(
            'INSERT INTO outbox_events (topic, aggregate_id, payload) VALUES ($1, $2, $3)',
            [
              'activity.finalized',
              updated.rows[0]!.id,
              JSON.stringify({ activityId: updated.rows[0]!.id })
            ]
          );
          return updated.rows[0]!;
        });
        if (activity === undefined) return reply.code(404).send({ message: 'Activity not found' });
        if (activity === null) return reply.code(400).send({ message: 'Unexpected chunk count' });
        return reply.code(202).send(activity);
      }
    );

    routes.get<{ Params: { activityId: string } }>(
      '/v1/activities/:activityId',
      {
        schema: {
          response: {
            200: ActivityStatusResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema
          }
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const accountId = requireAccount(request, reply, authSecret);
        if (!accountId) return;
        const result = await database.query<{
          id: string;
          status: 'received' | 'validating' | 'accepted' | 'rejected' | 'derived';
          summary: unknown;
          rejection_reason: string | null;
        }>(
          'SELECT id, status, summary, rejection_reason FROM activity_submissions WHERE id = $1 AND account_id = $2',
          [request.params.activityId, accountId]
        );
        if (!result.rows[0]) return reply.code(404).send({ message: 'Activity not found' });
        const row = result.rows[0];
        return {
          id: row.id,
          status: row.status,
          ...(row.summary ? { summary: row.summary } : {}),
          ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {})
        };
      }
    );
    done();
  });
  return app;
};
