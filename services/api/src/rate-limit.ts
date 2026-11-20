import type { FastifyInstance, FastifyRequest } from 'fastify';
import { accountIdFrom } from './auth-routes.js';

/**
 * Request rate limits (R5).
 *
 * A territory claim runs H3 and PostGIS work synchronously, and the map,
 * cluster and leaderboard reads are the next most expensive. Without a limit
 * one client could keep the database busy for everyone and run up the
 * ₹3,000/month budget. Limits are per account when the request carries a valid
 * token, otherwise per client address (which needs `TRUST_PROXY` behind a
 * load balancer).
 *
 * In-memory and per process, like the auth limiter: correct for the single
 * API instance this deployment runs. A second instance would need a shared
 * store.
 */
export interface RateRule {
  readonly name: string;
  readonly max: number;
  readonly windowMs: number;
  readonly matches: (method: string, path: string) => boolean;
}

export const defaultRateRules: readonly RateRule[] = [
  {
    name: 'territory_claim',
    max: 12,
    windowMs: 60_000,
    matches: (method, path) => method === 'POST' && path === '/v1/territory/claims'
  },
  {
    name: 'territory_read',
    max: 120,
    windowMs: 60_000,
    matches: (method, path) => method === 'GET' && path.startsWith('/v1/territory/')
  },
  {
    name: 'general',
    max: 600,
    windowMs: 60_000,
    matches: () => true
  }
];

/** Never limited: probes and scrapes, which come from infrastructure. */
const exempt = new Set(['/health', '/ready', '/metrics']);

/** Fixed-window counter with a hard cap on tracked keys. */
export const createRateLimiter = (maxKeys = 50_000) => {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const sweep = (now: number) => {
    for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
    // Still full after expiry: drop the oldest, so memory stays bounded under a flood.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  };
  return {
    hit(
      key: string,
      rule: RateRule,
      now = Date.now()
    ): { allowed: boolean; retryAfterSeconds: number } {
      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        if (windows.size >= maxKeys) sweep(now);
        windows.set(key, { count: 1, resetAt: now + rule.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      current.count += 1;
      return {
        allowed: current.count <= rule.max,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      };
    }
  };
};

const pathOf = (request: FastifyRequest) => request.url.split('?')[0] ?? request.url;

export const registerRateLimits = (
  app: FastifyInstance,
  authSecret: string,
  rules: readonly RateRule[] = defaultRateRules
) => {
  const limiter = createRateLimiter();
  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request);
    if (exempt.has(path)) return;
    const rule = rules.find((candidate) => candidate.matches(request.method, path));
    if (!rule) return;
    const subject = accountIdFrom(request, authSecret) ?? `ip:${request.ip}`;
    const { allowed, retryAfterSeconds } = limiter.hit(`${rule.name}:${subject}`, rule);
    if (!allowed)
      return reply
        .code(429)
        .header('retry-after', String(retryAfterSeconds))
        .send({ message: 'Too many requests. Wait a moment and try again.' });
  });
};
