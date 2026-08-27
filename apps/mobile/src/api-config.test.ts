import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './api-config.js';

describe('mobile API base URL', () => {
  it('normalizes a public backend URL without a trailing slash', () => {
    expect(getApiBaseUrl('https://api.runsphere.test/')).toBe('https://api.runsphere.test');
  });

  it('allows an unset URL for the m0 offline shell and rejects malformed URLs', () => {
    expect(getApiBaseUrl(undefined)).toBeUndefined();
    expect(() => getApiBaseUrl('not-a-url')).toThrow('EXPO_PUBLIC_API_BASE_URL');
  });
});
