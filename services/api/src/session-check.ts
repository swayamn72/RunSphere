import type { FastifyInstance } from 'fastify';
import type { Database } from '@runsphere/db';
import { verifyAccessClaims } from './auth.js';

/**
 * Ends access tokens when their session ends (R3). Tokens last 15 minutes,
 * and before this a signed-out, deleted or erasure-pending account kept
 * working until expiry. Every request carrying a valid token is checked
 * against the account and, when the token names one, its session. Answers
 * are cached briefly per session so this is about one indexed lookup per
 * session every few seconds, not one per request.
 */
export const registerSessionCheck = (
  app: FastifyInstance,
  database: Database,
  authSecret: string,
  cacheMs = 5_000
) => {
  const cache = new Map<string, { live: boolean; at: number }>();

  const isLive = async (accountId: string, sessionId: string | undefined): Promise<boolean> => {
    const key = `${accountId}:${sessionId ?? '-'}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.live;
    const row = await database.query<{ live: boolean }>(
      `SELECT (account.deleted_at IS NULL AND account.deletion_requested_at IS NULL
                AND ($2::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM refresh_token_families family
                  WHERE family.id = $2::uuid AND family.account_id = account.id
                    AND family.revoked_at IS NULL))) AS live
       FROM accounts account WHERE account.id = $1`,
      [accountId, sessionId ?? null]
    );
    const live = row.rows[0]?.live === true;
    if (cache.size > 50_000) cache.clear();
    cache.set(key, { live, at: Date.now() });
    return live;
  };

  // Signing out or deleting the account changes the answer for sessions this
  // process may have cached as live, so the cache starts over at once.
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 300) return;
    const path = request.url.split('?')[0];
    if (
      (request.method === 'POST' && path === '/v1/auth/logout') ||
      (request.method === 'DELETE' && path === '/v1/account')
    )
      cache.clear();
  });

  app.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const claims = verifyAccessClaims(header.slice(7), authSecret);
    // Invalid tokens are the routes' business: they already answer 401.
    if (!claims) return;
    if (!(await isLive(claims.sub, claims.sid)))
      return reply.code(401).send({ message: 'Unauthorized' });
  });
};
