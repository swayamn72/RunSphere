import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  AuthResponseSchema,
  ErrorResponseSchema,
  EmailVerificationCompleteRequestSchema,
  EmailVerificationRequestResponseSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  type EmailVerificationCompleteRequest,
  type LoginRequest,
  type RefreshRequest,
  type RegisterRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  hashPassword,
  issueSession,
  revokeSession,
  rotateSession,
  verifyAccessToken,
  verifyPassword
} from './auth.js';
import { loadRestrictions } from './sanction-guard.js';

const genericAuthError = { message: 'Invalid email or password' };
const emailVerificationLifetime = '24 hours';

const authRateLimit = new Map<string, { attempts: number; resetAt: number }>();

/**
 * Maximum number of entries the in-memory rate-limit map may hold. When this
 * limit is reached, all expired entries are purged first. If it is still
 * exceeded, the oldest entries are evicted to prevent unbounded growth under
 * credential-stuffing attacks.
 */
const AUTH_RATE_LIMIT_MAX_ENTRIES = 10_000;

const evictStaleEntries = () => {
  const now = Date.now();
  for (const [key, entry] of authRateLimit) {
    if (entry.resetAt <= now) authRateLimit.delete(key);
  }
  // If still over limit after expiry sweep, drop oldest entries.
  if (authRateLimit.size > AUTH_RATE_LIMIT_MAX_ENTRIES) {
    const excess = authRateLimit.size - AUTH_RATE_LIMIT_MAX_ENTRIES;
    let removed = 0;
    for (const key of authRateLimit.keys()) {
      if (removed >= excess) break;
      authRateLimit.delete(key);
      removed += 1;
    }
  }
};

export const allowAuthAttempt = (key: string) => {
  const now = Date.now();
  const current = authRateLimit.get(key);
  if (!current || current.resetAt <= now) {
    if (authRateLimit.size >= AUTH_RATE_LIMIT_MAX_ENTRIES) evictStaleEntries();
    authRateLimit.set(key, { attempts: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.attempts >= 10) return false;
  current.attempts += 1;
  return true;
};

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

export const accountIdFrom = (request: FastifyRequest, secret: string) => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? verifyAccessToken(value.slice(7), secret) : undefined;
};

export const requireAccount = (
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

export { audit };

export interface AuthRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

export const registerAuthRoutes = ({ routes, database, authSecret }: AuthRouteDeps) => {
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
};
