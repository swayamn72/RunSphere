import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import {
  PASSWORD_PROBLEM,
  emailChangeFailureMessage,
  passwordProblem,
  resetFailureMessage,
  tokenFromPasted,
  validEmail
} from './account-recovery-model';

const TOKEN = 'Abc123_-'.repeat(6);

describe('password reset and email change (M3.5)', () => {
  it('reads the token from a pasted link, a bare code, or nothing', () => {
    expect(tokenFromPasted(`https://app.example.com/reset-password?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromPasted(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(tokenFromPasted('hello there')).toBeUndefined();
    expect(tokenFromPasted('?token=short')).toBeUndefined();
  });

  it('checks the new password the way the server does', () => {
    expect(passwordProblem('short', 'short')).toBe(PASSWORD_PROBLEM.short);
    expect(passwordProblem('long-enough-password', 'different-password')).toBe(
      PASSWORD_PROBLEM.mismatch
    );
    expect(passwordProblem('long-enough-password', 'long-enough-password')).toBeUndefined();
  });

  it('accepts only an email-shaped address', () => {
    expect(validEmail(' maya@example.com ')).toBe(true);
    expect(validEmail('maya')).toBe(false);
  });

  it('says plainly when a link has expired, with no status codes', () => {
    expect(resetFailureMessage(new ApiFailure(400, 'Invalid or expired reset token'))).toMatch(
      /expired or was already used/
    );
    expect(resetFailureMessage(new ApiFailure(500, 'Request to /v1/x failed (500).'))).not.toMatch(
      /\/v1\/|500/
    );
    expect(emailChangeFailureMessage(new ApiFailure(409, 'taken'))).toMatch(/can't be used/);
  });
});
