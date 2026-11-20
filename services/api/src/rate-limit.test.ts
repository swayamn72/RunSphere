import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';
import { createRateLimiter, defaultRateRules } from './rate-limit.js';

/** R5: expensive endpoints are limited per account, cheap ones per client. */
const SECRET = 'rate-limit-test-secret';
const ACCOUNT_A = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT_B = '00000000-0000-4000-8000-0000000000b2';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const limitedApp = () => {
  const db = {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(),
    end: vi.fn()
  } as unknown as Database;
  const app = buildApp({ db, authSecret: SECRET, rateLimits: true });
  apps.push(app);
  return app;
};

const bearer = (account: string) => ({
  authorization: `Bearer ${createAccessToken(account, SECRET)}`
});

const claim = (app: ReturnType<typeof buildApp>, account: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/territory/claims',
    headers: bearer(account),
    payload: { activityId: '00000000-0000-4000-8000-0000000000c3' }
  });

describe('rate limits (R5)', () => {
  it('allows 12 territory claims a minute per account, then answers 429 with Retry-After', async () => {
    const app = limitedApp();
    for (let attempt = 0; attempt < 12; attempt += 1)
      expect((await claim(app, ACCOUNT_A)).statusCode).not.toBe(429);

    const limited = await claim(app, ACCOUNT_A);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each account separately', async () => {
    const app = limitedApp();
    for (let attempt = 0; attempt < 13; attempt += 1) await claim(app, ACCOUNT_A);

    expect((await claim(app, ACCOUNT_B)).statusCode).not.toBe(429);
  });

  it('never limits health checks', async () => {
    const app = limitedApp();
    for (let attempt = 0; attempt < 700; attempt += 1)
      await app.inject({ method: 'GET', url: '/health' });

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('is off by default under NODE_ENV=test, so integration suites are unaffected', async () => {
    const app = buildApp({ authSecret: SECRET });
    apps.push(app);
    for (let attempt = 0; attempt < 13; attempt += 1) await claim(app, ACCOUNT_A);

    expect((await claim(app, ACCOUNT_A)).statusCode).not.toBe(429);
  });

  it('opens a new window once the old one ends', () => {
    const limiter = createRateLimiter();
    const rule = defaultRateRules[0]!;
    for (let attempt = 0; attempt < 12; attempt += 1) limiter.hit('k', rule, 1_000);

    expect(limiter.hit('k', rule, 1_000).allowed).toBe(false);
    expect(limiter.hit('k', rule, 1_000 + rule.windowMs).allowed).toBe(true);
  });
});
