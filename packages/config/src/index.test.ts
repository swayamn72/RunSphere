import { describe, expect, it } from 'vitest';
import { loadApiConfig } from './index.js';

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
