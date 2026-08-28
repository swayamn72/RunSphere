import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { ApiConfig } from '@runsphere/config';
import {
  ActivityChunkHeadersSchema,
  ActivityChunkRequestSchema,
  ActivityCreateRequestSchema,
  ActivityFinalizeRequestSchema,
  ActivityListResponseSchema,
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
const rawTraceRetentionInterval = '30 days';
type ActivityState = 'received' | 'validating' | 'accepted' | 'rejected' | 'derived' | 'deleted';
type ActivityRow = {
  id: string;
  status: ActivityState;
  summary: unknown;
  rejection_reason: string | null;
  validation_errors: unknown;
  expected_chunk_count: number | null;
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
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
    ...(validationErrors(row.validation_errors).length
      ? { validationErrors: validationErrors(row.validation_errors) }
      : {}),
    ...(missing ? { missingSequences: missing } : {})
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
            401: ErrorResponseSchema,
            409: ErrorResponseSchema
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
            204: { type: 'null' },
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
          body: ActivityFinalizeRequestSchema,
          response: {
            202: ActivityStatusResponseSchema,
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
            checksum: string;
            minimum: number | null;
            maximum: number | null;
          }>(
            `SELECT count(*)::text AS count, coalesce(string_agg(payload_hash, '' ORDER BY sequence), '') AS checksum,
              min(sequence) AS minimum, max(sequence) AS maximum FROM activity_chunks WHERE activity_id = $1`,
            [request.params.activityId]
          );
          const aggregateChecksum = sha256(chunks.rows[0]!.checksum);
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

    routes.get(
      '/v1/activities',
      {
        schema: {
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
          `SELECT id, status, summary, rejection_reason, validation_errors, expected_chunk_count
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
             submission.validation_errors, submission.expected_chunk_count,
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
          response: { 204: { type: 'null' }, 401: ErrorResponseSchema, 404: ErrorResponseSchema }
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
    done();
  });
  return app;
};
