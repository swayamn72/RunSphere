import type { FastifyInstance } from 'fastify';
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
  ErrorResponseSchema,
  activityFinalizeChecksumInput,
  type ActivityChunkRequest,
  type ActivityCreateRequest,
  type ActivityFinalizeRequest
} from '@runsphere/contracts';
import { sha256, withTransaction, type Database } from '@runsphere/db';
import { requireAccount } from './auth-routes.js';
import { chunkHash } from './activity.js';

const rawTraceRetentionInterval = '30 days';

export type ActivityState = 'received' | 'validating' | 'accepted' | 'rejected' | 'derived' | 'deleted';
export type ActivityRow = {
  id: string;
  status: ActivityState;
  summary: unknown;
  rejection_reason: string | null;
  validation_errors: unknown;
  expected_chunk_count: number | null;
  movement_type?: 'run';
  created_at?: Date | string;
};

export const validationErrors = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export const missingSequences = async (
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

export const statusResponse = async (database: Database, row: ActivityRow) => {
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

export interface ActivityRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

export const registerActivityRoutes = ({ routes, database, authSecret }: ActivityRouteDeps) => {
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
      // The fingerprint is what makes an idempotency key safe: replaying a key
      // with a *different* body is a client bug, and answering 200 with the
      // first activity's id would hide it.
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
};
