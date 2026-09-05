import { describe, expect, it } from 'vitest';
import {
  SHARING_SUSPENDED_KINDS,
  appealRevokesSanction,
  canAppealSanction,
  canModerate,
  canReport,
  isReportReason,
  sanctionBlocksSharing,
  sanctionBlocksSignIn,
  restrictionsFor,
  sanctionInForce,
  sanctionMayExpire
} from './moderation.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const ME = 'account-me';
const RAVI = 'account-ravi';

describe('who may moderate', () => {
  it('is the moderator and the admin, and nobody else', () => {
    expect(canModerate(['moderator'])).toBe(true);
    expect(canModerate(['admin'])).toBe(true);
    expect(canModerate(['season_operator', 'support'])).toBe(false);
    expect(canModerate([])).toBe(false);
  });
});

describe('filing a report', () => {
  it('accepts a published reason about somebody else', () => {
    expect(canReport({ reporterAccountId: ME, subjectId: RAVI, reason: 'harassment' })).toBe(true);
  });

  it('refuses a report about yourself, which is not a moderation action', () => {
    expect(canReport({ reporterAccountId: ME, subjectId: ME, reason: 'harassment' })).toBe(false);
  });

  it('refuses a reason nobody published', () => {
    expect(canReport({ reporterAccountId: ME, subjectId: RAVI, reason: 'too_fast' })).toBe(false);
    expect(isReportReason('impersonation')).toBe(true);
    expect(isReportReason('slow')).toBe(false);
  });
});

describe('what a sanction does', () => {
  it('takes nothing away for a warning', () => {
    expect(sanctionBlocksSharing('warning')).toBe(false);
    expect(sanctionBlocksSignIn('warning')).toBe(false);
  });

  it('removes the sharing surfaces for a social suspension, and nothing else', () => {
    expect(sanctionBlocksSharing('social_suspension')).toBe(true);
    // Somebody's own activity data stays theirs: a suspension is not a way to
    // withhold it.
    expect(sanctionBlocksSignIn('social_suspension')).toBe(false);
  });

  it('stops the account entirely only for an account suspension', () => {
    expect(sanctionBlocksSharing('account_suspension')).toBe(true);
    expect(sanctionBlocksSignIn('account_suspension')).toBe(true);
  });

  it('lets everything but a warning carry an end date', () => {
    expect(sanctionMayExpire('warning')).toBe(false);
    expect(sanctionMayExpire('social_suspension')).toBe(true);
    expect(sanctionMayExpire('account_suspension')).toBe(true);
  });
});

describe('when a sanction applies', () => {
  it('applies until it expires', () => {
    expect(sanctionInForce({ expiresAt: new Date('2026-09-06T00:00:00.000Z') }, NOW)).toBe(true);
    expect(sanctionInForce({ expiresAt: new Date('2026-09-05T00:00:00.000Z') }, NOW)).toBe(false);
  });

  it('applies indefinitely with no end date', () => {
    expect(sanctionInForce({}, NOW)).toBe(true);
  });

  it('stops the moment it is revoked, whatever its end date said', () => {
    expect(
      sanctionInForce({ expiresAt: new Date('2027-01-01T00:00:00.000Z'), revokedAt: NOW }, NOW)
    ).toBe(false);
  });
});

describe('appealing', () => {
  it('is available once, while the sanction still applies', () => {
    expect(canAppealSanction({}, false, NOW)).toBe(true);
  });

  it('is not available twice', () => {
    expect(canAppealSanction({}, true, NOW)).toBe(false);
  });

  it('is not available against something that no longer applies', () => {
    expect(canAppealSanction({ expiresAt: new Date('2026-09-01T00:00:00.000Z') }, false, NOW)).toBe(
      false
    );
    expect(canAppealSanction({ revokedAt: NOW }, false, NOW)).toBe(false);
  });

  it('revokes the sanction only when the appeal succeeds', () => {
    // "Upheld" is the sanction being upheld — the appeal failing. The words
    // are the appellant's-eye view, so this is the one to keep straight.
    expect(appealRevokesSanction('upheld')).toBe(false);
    expect(appealRevokesSanction('overturned')).toBe(true);
  });
});

describe('what an account is currently restricted from', () => {
  const suspension = {
    kind: 'social_suspension' as const,
    statement: 'Sharing is paused while we look at your display name.'
  };

  it('is nothing when no sanction is in force', () => {
    expect(restrictionsFor([], NOW)).toEqual({
      sharingPaused: false,
      signInBlocked: false,
      statement: undefined
    });
  });

  it('ignores a sanction that has expired or been revoked', () => {
    expect(
      restrictionsFor([{ ...suspension, expiresAt: new Date('2026-09-01T00:00:00.000Z') }], NOW)
        .sharingPaused
    ).toBe(false);
    expect(restrictionsFor([{ ...suspension, revokedAt: NOW }], NOW).sharingPaused).toBe(false);
  });

  it('pauses sharing without blocking sign-in for a social suspension', () => {
    expect(restrictionsFor([suspension], NOW)).toEqual({
      sharingPaused: true,
      signInBlocked: false,
      statement: 'Sharing is paused while we look at your display name.'
    });
  });

  it('shows the words of the strictest restriction in force', () => {
    const restrictions = restrictionsFor(
      [
        { kind: 'warning', statement: 'Please keep club names civil.' },
        suspension,
        { kind: 'account_suspension', statement: 'Your account is suspended for 7 days.' }
      ],
      NOW
    );

    expect(restrictions).toMatchObject({ sharingPaused: true, signInBlocked: true });
    // An account that cannot sign in reads why it cannot sign in, not why its
    // sharing is paused.
    expect(restrictions.statement).toBe('Your account is suspended for 7 days.');
  });

  it('does not let one sanction cancel another out', () => {
    // A live suspension alongside an ended one still applies.
    expect(
      restrictionsFor([{ ...suspension, revokedAt: NOW }, suspension], NOW).sharingPaused
    ).toBe(true);
  });

  it('keeps the enforcement list derived from the kinds themselves', () => {
    expect([...SHARING_SUSPENDED_KINDS]).toEqual(['social_suspension', 'account_suspension']);
  });
});
