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

  it('lists deterministic starter quests', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/v1/quests' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(3);
    expect(response.json().data[0]).toMatchObject({ id: 'riverside-rings', rewardXp: 80 });
  });

  it('returns a useful 404 when a quest does not exist', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/v1/quests/not-a-quest' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Quest not found' });
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

  it('publishes health and quests in the OpenAPI document', async () => {
    const app = createApp();
    await app.ready();
    const document = app.swagger();
    expect(document.paths).toHaveProperty('/health');
    expect(document.paths).toHaveProperty('/v1/quests');
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
