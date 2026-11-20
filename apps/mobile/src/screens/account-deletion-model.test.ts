import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';
import { DELETION_EXPLANATION, canSubmitDeletion, deletionFailure } from './account-deletion-model';

describe('account deletion model (ADR-0012)', () => {
  it('says plainly that deletion is permanent and immediate, with no grace period', () => {
    expect(DELETION_EXPLANATION).toContain('cannot be undone');
    expect(DELETION_EXPLANATION).toContain('signed out on every device');
    expect(DELETION_EXPLANATION).not.toMatch(/30-day|waiting period|grace/i);
  });

  it('needs a typed password and nothing in flight before it can submit', () => {
    expect(canSubmitDeletion('', false)).toBe(false);
    expect(canSubmitDeletion('secret', true)).toBe(false);
    expect(canSubmitDeletion('secret', false)).toBe(true);
  });

  it('names a wrong password as a wrong password, without ending the session', () => {
    const failure = deletionFailure(new AuthFailure('invalid-credentials', 403));
    expect(failure.message).toMatch(/password is not right/);
    expect(failure.sessionExpired).toBe(false);
  });

  it('hands an ended session to sign-out', () => {
    expect(deletionFailure(new AuthFailure('invalid-credentials', 401)).sessionExpired).toBe(true);
  });

  it('separates connectivity and rate limits from refusals', () => {
    expect(deletionFailure(new AuthFailure('network')).message).toMatch(/could not be reached/);
    expect(deletionFailure(new ApiFailure(429, 'Too many attempts')).message).toMatch(/Too many/);
    expect(deletionFailure(new Error('boom')).message).toMatch(/Nothing was changed/);
  });
});
