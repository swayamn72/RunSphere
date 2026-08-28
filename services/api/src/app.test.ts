import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, pinoRedactionPaths } from './app.js';

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

  it('returns not-ready without a database and publishes low-cardinality metrics', async () => {
    const app = createApp();
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });

    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not_ready', service: 'api' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain(
      'runsphere_http_requests_total{service="api",status_code="503"} 1'
    );
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
