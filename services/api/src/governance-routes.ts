import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ActivityAuthorizationHeadersSchema, ErrorResponseSchema } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { verifyAccessToken } from './auth.js';

// Written as plain JSON Schema rather than TypeBox: these two responses are
// staff-only reads with no client contract to share, and the API package does
// not otherwise depend on the schema builder.
const uuid = { type: 'string', format: 'uuid' } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;

/**
 * Privacy and data-stewardship reads (Phase 3, milestone 3.12).
 *
 * Two of the three placeholder areas in the console become real here. Both are
 * **read-only on purpose**:
 *
 * - A privacy officer's job is to see that export and erasure requests actually
 *   converge, not to run them by hand. The worker performs deletion; a console
 *   button that deleted an account outside that path would be a second way to
 *   destroy data, with none of the worker's ordering guarantees.
 * - Rules are published by migration, so a data steward reads which version is
 *   live and when it took effect. A console that edited a rule would let
 *   gameplay change without a reviewed migration behind it.
 *
 * What is deliberately absent: an email address, a display name, or any
 * activity detail. A privacy queue is account ids, states, and timestamps —
 * enough to confirm a request completed, and not a directory of who asked.
 */
export interface GovernanceRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const value = request.headers.authorization;
  const accountId = value?.startsWith('Bearer ')
    ? verifyAccessToken(value.slice(7), secret)
    : undefined;
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

const staffRoles = async (database: Database, accountId: string): Promise<string[]> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1',
    [accountId]
  );
  return result.rows.map((row) => row.role);
};

const staffAudit = (
  database: Database,
  accountId: string,
  action: string,
  targetType: string
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
     VALUES ($1, $2, $3, 1)`,
    [accountId, action, targetType]
  );

const hasRole = (roles: readonly string[], role: string): boolean =>
  roles.includes(role) || roles.includes('admin');

/**
 * One open request. `openForHours` is the number a privacy officer is actually
 * watching: they are looking for the request that stopped moving.
 */
const privacyRequestSchema = {
  type: 'object',
  properties: {
    accountId: uuid,
    kind: { type: 'string', enum: ['export', 'deletion'] },
    requestedAt: dateTime,
    // For an export, when the download stops working.
    expiresAt: dateTime,
    openForHours: { type: 'integer', minimum: 0 }
  },
  required: ['accountId', 'kind', 'requestedAt', 'openForHours']
} as const;

const privacyQueueResponseSchema = {
  type: 'object',
  properties: {
    // Erasures that converged, as a count. Never a list of who was erased.
    completedDeletions: { type: 'integer', minimum: 0 },
    data: { type: 'array', maxItems: 200, items: privacyRequestSchema }
  },
  required: ['completedDeletions', 'data']
} as const;

const ruleVersionSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', minLength: 1, maxLength: 40 },
    version: { type: 'integer', minimum: 1 },
    definition: {},
    effectiveAt: dateTime,
    supersededAt: dateTime,
    live: { type: 'boolean' }
  },
  required: ['kind', 'version', 'definition', 'effectiveAt', 'live']
} as const;

const ruleVersionListResponseSchema = {
  type: 'object',
  properties: { data: { type: 'array', maxItems: 200, items: ruleVersionSchema } },
  required: ['data']
} as const;

export const registerGovernanceRoutes = ({
  routes,
  database,
  authSecret
}: GovernanceRouteDeps): void => {
  /**
   * Open export and erasure requests, oldest first.
   *
   * The point of this queue is the age of the oldest row: an erasure that
   * stopped converging is a compliance failure, and it is invisible unless
   * somebody can see that it has been open for three days. Completed erasures
   * are a count, because a list of who was erased would rebuild the very thing
   * erasure removed.
   */
  routes.get(
    '/v1/staff/privacy/requests',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: privacyQueueResponseSchema,
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
      if (!hasRole(await staffRoles(database, accountId), 'privacy_officer'))
        return reply.code(403).send({ message: 'The privacy queue needs a privacy officer role' });

      const open = await database.query<{
        account_id: string;
        kind: 'export' | 'deletion';
        requested_at: Date;
        expires_at: Date | null;
      }>(
        `SELECT account_id, 'export' AS kind, requested_at, expires_at
         FROM account_export_requests
         WHERE status = 'ready'
         UNION ALL
         SELECT id AS account_id, 'deletion' AS kind, deletion_requested_at AS requested_at,
           NULL AS expires_at
         FROM accounts
         WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL
         ORDER BY requested_at
         LIMIT 200`
      );
      const completed = await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM account_deletion_tombstones'
      );
      await staffAudit(database, accountId, 'privacy.queue.read', 'account');

      const now = Date.now();
      return {
        completedDeletions: Number(completed.rows[0]?.count ?? 0),
        data: open.rows.map((row) => ({
          accountId: row.account_id,
          kind: row.kind,
          requestedAt: row.requested_at.toISOString(),
          ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
          openForHours: Math.max(0, Math.floor((now - row.requested_at.getTime()) / 3_600_000))
        }))
      };
    }
  );

  /**
   * Every published rule version, newest first within each kind.
   *
   * Read-only: rules are published by migration, so this answers "what is live
   * right now, and since when" — the question a data steward actually has when
   * a score looks wrong. Editing here would let gameplay change without a
   * reviewed migration behind it.
   */
  routes.get(
    '/v1/staff/rules',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ruleVersionListResponseSchema,
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
      if (!hasRole(await staffRoles(database, accountId), 'data_steward'))
        return reply.code(403).send({ message: 'Rule versions need a data steward role' });

      const rules = await database.query<{
        kind: string;
        version: number;
        definition: unknown;
        effective_at: Date;
        superseded_at: Date | null;
      }>(
        `SELECT kind, version, definition, effective_at, superseded_at
         FROM rule_versions
         ORDER BY kind, version DESC
         LIMIT 200`
      );
      await staffAudit(database, accountId, 'rules.read', 'rule_version');
      return {
        data: rules.rows.map((row) => ({
          kind: row.kind,
          version: row.version,
          definition: row.definition,
          effectiveAt: row.effective_at.toISOString(),
          ...(row.superseded_at ? { supersededAt: row.superseded_at.toISOString() } : {}),
          live: row.superseded_at === null
        }))
      };
    }
  );
};
