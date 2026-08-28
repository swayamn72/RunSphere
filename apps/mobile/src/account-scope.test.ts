import { describe, expect, it } from 'vitest';
import { accountScopeFor, legacyAccountScopesFor } from './account-scope.js';

const encoded = (value: unknown) =>
  globalThis
    .btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const session = {
  accessToken: `${encoded({ sub: '8e7b0924-12fe-48d7-9bca-2ab3c055fa10' })}.signature`,
  refreshToken: 'legacy-refresh-token',
  expiresInSeconds: 900
};

describe('local account scope upgrade', () => {
  it('uses the server UUID and identifies old token-derived partitions for one-way re-keying', () => {
    expect(accountScopeFor(session)).toBe('8e7b0924-12fe-48d7-9bca-2ab3c055fa10');
    expect(legacyAccountScopesFor(session)).toEqual(
      expect.arrayContaining(['account:8e7b0924-12fe-48d7-9bca-2ab3c055fa10'])
    );
  });

  it('does not silently fall back to a rotating token-derived account scope', () => {
    expect(() => accountScopeFor({ ...session, accessToken: 'opaque-token' })).toThrow(
      'server account identifier'
    );
  });
});
