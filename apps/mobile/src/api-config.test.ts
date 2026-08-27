import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './api-config.js';

describe('mobile API base URL', () => {
  it('normalizes a public HTTPS backend URL without a trailing slash', () => {
    expect(getApiBaseUrl('https://api.runsphere.test/', 'production')).toBe(
      'https://api.runsphere.test'
    );
  });

  it('allows HTTP only for local development endpoints', () => {
    expect(getApiBaseUrl('http://10.0.2.2:3000/', 'development')).toBe('http://10.0.2.2:3000');
    expect(() => getApiBaseUrl('http://api.runsphere.test', 'development')).toThrow('HTTPS');
    expect(() => getApiBaseUrl('http://localhost:3000', 'production')).toThrow('HTTPS');
  });

  it('allows an unset URL and rejects malformed URLs', () => {
    expect(getApiBaseUrl(undefined)).toBeUndefined();
    expect(() => getApiBaseUrl('not-a-url')).toThrow('EXPO_PUBLIC_API_BASE_URL');
  });
});
