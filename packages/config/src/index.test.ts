import { describe, expect, it } from 'vitest';
import { loadApiConfig, pinoRedactionPaths } from './index.js';

describe('API configuration', () => {
  it('uses local development defaults', () => {
    expect(loadApiConfig({})).toMatchObject({
      host: '0.0.0.0',
      port: 3001,
      allowedOrigins: ['http://localhost:4173']
    });
  });

  it('rejects malformed ports and origin allowlists', () => {
    expect(() => loadApiConfig({ PORT: 'not-a-port' })).toThrow('PORT must be an integer');
    expect(() => loadApiConfig({ CORS_ALLOWED_ORIGINS: 'not-a-url' })).toThrow(
      'CORS_ALLOWED_ORIGINS'
    );
  });
});

it('accepts an exact public admin preview origin', () => {
  expect(
    loadApiConfig({
      CORS_ALLOWED_ORIGINS: 'https://preview-admin.runsphere.test,https://admin.runsphere.test'
    }).allowedOrigins
  ).toEqual(['https://preview-admin.runsphere.test', 'https://admin.runsphere.test']);
});

describe('Pino redaction paths', () => {
  it('covers cookies, credential fields, and location payload fields without redacting request bodies wholesale', () => {
    expect(pinoRedactionPaths).toEqual(
      expect.arrayContaining([
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'res.headers["set-cookie"]',
        'req.body.password',
        'req.body.email',
        'req.body.*.accessToken',
        'req.body.coordinates',
        'req.body.geometry.coordinates',
        'req.body.points.*.latitude',
        'req.body.polyline',
        'req.body.placeId',
        'res.body.coordinates'
      ])
    );
    expect(pinoRedactionPaths).not.toContain('req.body');
    expect(pinoRedactionPaths).not.toContain('res.body');
  });
});
