import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, parseTrustProxy, pinoRedactionPaths } from './app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const createApp = () => {
  const app = buildApp();
  apps.push(app);
  return app;
};

describe('API routes', () => {
  it('returns a schema-backed health response', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });
    expect(response.json().timestamp).toEqual(expect.any(String));
  });

  it('protects low-cardinality metrics with a collector token', async () => {
    const app = buildApp({ config: { metricsCollectorToken: 'collector-token' } });
    apps.push(app);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    const rejected = await app.inject({ method: 'GET', url: '/metrics' });
    const metrics = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer collector-token' }
    });

    expect(ready.statusCode).toBe(503);
    expect(rejected.statusCode).toBe(401);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain(
      'runsphere_http_requests_total{service="api",status_code="503"} 1'
    );
  });

  it('does not expose metrics when no collector token is configured', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(404);
  });

  it('requires the reviewed quest catalog database rather than serving demo or XP data', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/v1/quests' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ message: 'Service unavailable' });
  });

  it('does not claim an unknown quest exists while the catalog is unavailable', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/v1/quests/not-a-quest' });
    expect(response.statusCode).toBe(503);
  });

  it('only permits configured browser origins, including a public admin preview', async () => {
    const app = buildApp({
      config: { allowedOrigins: ['https://preview-admin.runsphere.test'] }
    });
    apps.push(app);
    const accepted = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://preview-admin.runsphere.test' }
    });
    const rejected = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://untrusted.test' }
    });
    expect(accepted.headers['access-control-allow-origin']).toBe(
      'https://preview-admin.runsphere.test'
    );
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes health, readiness, quests, and staff review in the OpenAPI document', async () => {
    const app = createApp();
    await app.ready();
    const document = app.swagger();
    expect(document.paths).toHaveProperty('/health');
    expect(document.paths).toHaveProperty('/ready');
    expect(document.paths).toHaveProperty('/v1/quests');
    expect(document.paths).toHaveProperty('/v1/staff/activity-review-queue');
  });
});

describe('Pino redaction', () => {
  it('redacts sensitive request and application fields', () => {
    const output: string[] = [];
    const logger = pino(
      { redact: { paths: [...pinoRedactionPaths], censor: '[REDACTED]' } },
      { write: (entry: string) => output.push(entry) }
    ) as FastifyBaseLogger;
    const app = buildApp({ loggerInstance: logger });
    apps.push(app);
    app.log.info({ token: 'private', authorization: 'Bearer private' }, 'redaction check');
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('[REDACTED]');
    expect(output[0]).not.toContain('private');
  });
});

describe('TRUST_PROXY parsing (R4)', () => {
  it('stays off unless configured, because trusting the header with no proxy lets clients pick their IP', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('accepts true or an explicit list of proxies', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.4')).toEqual(['10.0.0.0/8', '192.168.1.4']);
  });

  it('accepts a hop count for hosts whose proxy addresses are not published (Railway)', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('uses the forwarded client address for request.ip only when a proxy is trusted', async () => {
    const previous = process.env.TRUST_PROXY;
    try {
      const seen: string[] = [];
      for (const setting of [undefined, '127.0.0.1']) {
        if (setting === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = setting;
        const app = buildApp();
        apps.push(app);
        app.get('/whoami', async (request) => ({ ip: request.ip }));
        const response = await app.inject({
          method: 'GET',
          url: '/whoami',
          remoteAddress: '127.0.0.1',
          headers: { 'x-forwarded-for': '203.0.113.9' }
        });
        seen.push((response.json() as { ip: string }).ip);
      }
      expect(seen).toEqual(['127.0.0.1', '203.0.113.9']);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });

  it('with one trusted hop, a client cannot pick its IP by sending the header itself', async () => {
    const previous = process.env.TRUST_PROXY;
    try {
      process.env.TRUST_PROXY = '1';
      const app = buildApp();
      apps.push(app);
      app.get('/whoami', async (request) => ({ ip: request.ip }));
      // The client forged 198.51.100.1; the proxy appended the real 203.0.113.9.
      const response = await app.inject({
        method: 'GET',
        url: '/whoami',
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }
      });
      expect((response.json() as { ip: string }).ip).toBe('203.0.113.9');
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });
});
