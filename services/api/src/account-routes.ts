import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  EmailChangeCompleteRequestSchema,
  EmailChangeRequestSchema,
  EmailChangeRequestedResponseSchema,
  ErrorResponseSchema,
  PasswordResetCompleteRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetRequestedResponseSchema,
  PublicDeletionCompleteRequestSchema,
  PublicDeletionRequestSchema,
  PublicDeletionRequestedResponseSchema,
  StaffRolesResponseSchema,
  type EmailChangeCompleteRequest,
  type EmailChangeRequest,
  type PasswordResetCompleteRequest,
  type PasswordResetRequest,
  type PublicDeletionCompleteRequest,
  type PublicDeletionRequest,
  type StaffRolesResponse
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { hashPassword, verifyAccessToken } from './auth.js';

export interface AccountLifecycleRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const passwordResetLifetime = '1 hour';
const emailChangeLifetime = '24 hours';
const deletionLifetime = '24 hours';

const accountIdFrom = (request: FastifyRequest, secret: string): string | undefined => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? verifyAccessToken(value.slice(7), secret) : undefined;
};

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const accountId = accountIdFrom(request, secret);
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

const audit = (
  database: Database,
  accountId: string,
  eventType: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id, metadata)
     VALUES ($1, $1, $2, $3, $4, $5)`,
    [accountId, eventType, resourceType, resourceId ?? null, JSON.stringify(metadata)]
  );

const revokeAllSessions = async (database: Database, accountId: string): Promise<void> => {
  await database.query(
    `UPDATE refresh_token_families SET revoked_at = coalesce(revoked_at, now())
     WHERE account_id = $1 AND revoked_at IS NULL`,
    [accountId]
  );
};

// Unauthenticated flows get a small per-IP(+email) limiter so they cannot be
// used for address enumeration or inbox flooding.
const unauthenticatedRateLimit = new Map<string, { attempts: number; resetAt: number }>();
const allowAttempt = (key: string): boolean => {
  const now = Date.now();
  const current = unauthenticatedRateLimit.get(key);
  if (!current || current.resetAt <= now) {
    unauthenticatedRateLimit.set(key, { attempts: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.attempts >= 10) return false;
  current.attempts += 1;
  return true;
};

const staffRoles = async (database: Database, accountId: string): Promise<StaffRolesResponse> => {
  const result = await database.query<{ role: string }>(
    'SELECT role FROM staff_role_assignments WHERE account_id = $1 ORDER BY role',
    [accountId]
  );
  return { roles: result.rows.map((row) => row.role) };
};

export const registerAccountLifecycleRoutes = ({
  routes,
  database,
  authSecret
}: AccountLifecycleRouteDeps): void => {
  routes.post<{ Body: PasswordResetRequest }>(
    '/v1/account/password-reset',
    {
      schema: {
        tags: ['auth'],
        body: PasswordResetRequestSchema,
        response: {
          202: PasswordResetRequestedResponseSchema,
          429: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const email = request.body.email.trim().toLowerCase();
      if (!allowAttempt(`password-reset:${request.ip}:${email}`))
        return reply.code(429).send({ message: 'Too many attempts' });
      const account = await database.query<{ id: string }>(
        `INSERT INTO password_reset_tokens (account_id, token_hash, expires_at)
         SELECT id, encode(digest($1, 'sha256'), 'hex'), now() + $2::interval
         FROM accounts WHERE lower(email) = lower($3) AND deleted_at IS NULL
         RETURNING account_id AS id`,
        [randomBytes(32).toString('base64url'), passwordResetLifetime, email]
      );
      // Generic on purpose: never reveal whether the address exists.
      if (account.rows[0]) {
        await audit(
          database,
          account.rows[0].id,
          'password_reset.requested',
          'account',
          account.rows[0].id
        );
      }
      return reply.code(202).send({ status: 'requested' });
    }
  );

  routes.post<{ Body: PasswordResetCompleteRequest }>(
    '/v1/account/password-reset/complete',
    {
      schema: {
        tags: ['auth'],
        body: PasswordResetCompleteRequestSchema,
        response: {
          204: { type: 'null' },
          400: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const completed = await database.query<{ account_id: string }>(
        `UPDATE password_reset_tokens SET consumed_at = now()
         WHERE token_hash = encode(digest($1, 'sha256'), 'hex')
           AND consumed_at IS NULL AND expires_at > now()
         RETURNING account_id`,
        [request.body.token]
      );
      const accountId = completed.rows[0]?.account_id;
      if (!accountId) return reply.code(400).send({ message: 'Invalid or expired reset token' });
      await database.query(
        'UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1',
        [accountId, await hashPassword(request.body.newPassword)]
      );
      await revokeAllSessions(database, accountId);
      await audit(database, accountId, 'password_reset.completed', 'account', accountId);
      return reply.code(204).send();
    }
  );

  routes.post<{ Body: EmailChangeRequest }>(
    '/v1/account/email-change',
    {
      schema: {
        tags: ['account'],
        headers: ActivityAuthorizationHeadersSchema,
        body: EmailChangeRequestSchema,
        response: {
          202: EmailChangeRequestedResponseSchema,
          400: ErrorResponseSchema,
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
      const newEmail = request.body.newEmail.trim().toLowerCase();
      const account = await database.query<{ email: string }>(
        'SELECT email FROM accounts WHERE id = $1 AND deleted_at IS NULL',
        [accountId]
      );
      if (!account.rows[0]) return reply.code(401).send({ message: 'Unauthorized' });
      if (account.rows[0].email === newEmail)
        return reply.code(400).send({ message: 'New email must differ from current email' });
      const taken = await database.query<{ id: string }>(
        'SELECT id FROM accounts WHERE lower(email) = lower($1) AND id <> $2 AND deleted_at IS NULL',
        [newEmail, accountId]
      );
      if (taken.rows[0]) return reply.code(409).send({ message: 'Email unavailable' });
      const created = await database.query<{ id: string }>(
        `INSERT INTO email_change_requests (account_id, old_email, new_email, token_hash, expires_at)
         SELECT $1, email, $2, encode(digest($3, 'sha256'), 'hex'), now() + $4::interval
         FROM accounts WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`,
        [accountId, newEmail, randomBytes(32).toString('base64url'), emailChangeLifetime]
      );
      await audit(database, accountId, 'email_change.requested', 'account', created.rows[0]!.id, {
        oldEmail: account.rows[0].email,
        newEmail
      });
      return reply.code(202).send({ status: 'requested' });
    }
  );

  routes.post<{ Body: EmailChangeCompleteRequest }>(
    '/v1/account/email-change/complete',
    {
      schema: {
        tags: ['account'],
        body: EmailChangeCompleteRequestSchema,
        response: {
          204: { type: 'null' },
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const verified = await database.query<{
        account_id: string;
        old_email: string;
        new_email: string;
      }>(
        `UPDATE email_change_requests SET status = 'verified', verified_at = now()
         WHERE token_hash = encode(digest($1, 'sha256'), 'hex') AND status = 'pending'
           AND expires_at > now()
         RETURNING account_id, old_email, new_email`,
        [request.body.token]
      );
      const row = verified.rows[0];
      if (!row) return reply.code(400).send({ message: 'Invalid or expired email-change token' });
      try {
        await database.query(
          `UPDATE accounts SET email = $2, email_verified_at = now(),
             email_verification_status = 'verified', updated_at = now()
           WHERE id = $1`,
          [row.account_id, row.new_email]
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ message: 'Email unavailable' });
        throw error;
      }
      await revokeAllSessions(database, row.account_id);
      await audit(database, row.account_id, 'email_change.completed', 'account', row.account_id, {
        oldEmail: row.old_email,
        newEmail: row.new_email
      });
      return reply.code(204).send();
    }
  );

  routes.post<{ Body: PublicDeletionRequest }>(
    '/v1/account/deletion-request',
    {
      schema: {
        tags: ['account'],
        body: PublicDeletionRequestSchema,
        response: {
          202: PublicDeletionRequestedResponseSchema,
          429: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const email = request.body.email.trim().toLowerCase();
      if (!allowAttempt(`deletion-request:${request.ip}:${email}`))
        return reply.code(429).send({ message: 'Too many attempts' });
      const account = await database.query<{ id: string }>(
        'SELECT id FROM accounts WHERE lower(email) = lower($1) AND deleted_at IS NULL',
        [email]
      );
      // Generic on purpose: never reveal whether the address exists.
      if (account.rows[0]) {
        await database.query(
          `INSERT INTO public_deletion_requests (email, verification_token_hash, expires_at)
           VALUES (lower($1), encode(digest($2, 'sha256'), 'hex'), now() + $3::interval)`,
          [email, randomBytes(32).toString('base64url'), deletionLifetime]
        );
      }
      return reply.code(202).send({ status: 'requested' });
    }
  );

  routes.post<{ Body: PublicDeletionCompleteRequest }>(
    '/v1/account/deletion-request/complete',
    {
      schema: {
        tags: ['account'],
        body: PublicDeletionCompleteRequestSchema,
        response: {
          204: { type: 'null' },
          400: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const completed = await database.query<{ email: string }>(
        `UPDATE public_deletion_requests SET status = 'verified', completed_at = now()
         WHERE verification_token_hash = encode(digest($1, 'sha256'), 'hex') AND status = 'requested'
           AND expires_at > now()
         RETURNING email`,
        [request.body.token]
      );
      const email = completed.rows[0]?.email;
      if (!email) return reply.code(400).send({ message: 'Invalid or expired deletion token' });
      const account = await database.query<{ id: string }>(
        'SELECT id FROM accounts WHERE lower(email) = lower($1) AND deleted_at IS NULL',
        [email]
      );
      if (account.rows[0]) {
        await database.query(
          `UPDATE accounts SET deletion_requested_at = coalesce(deletion_requested_at, now()),
             profile_visibility = 'private', updated_at = now() WHERE id = $1`,
          [account.rows[0].id]
        );
        await revokeAllSessions(database, account.rows[0].id);
      }
      return reply.code(204).send();
    }
  );

  routes.get(
    '/v1/staff/roles',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: StaffRolesResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      return staffRoles(database, accountId);
    }
  );
};
