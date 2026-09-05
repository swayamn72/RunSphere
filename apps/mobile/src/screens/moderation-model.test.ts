import { describe, expect, it } from 'vitest';
import type { Sanction } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure.js';
import { ApiFailure } from '../api-client.js';
import {
  APPEAL_CONSEQUENCE,
  REPORT_CONSEQUENCE_HINT,
  REPORT_REASONS_IN_ORDER,
  REPORT_REASON_LABEL,
  appealFailureNotice,
  reportFailureNotice,
  sanctionRows,
  validateAppeal
} from './moderation-model.js';
import { clubBoardFailureNotice, clubChallengeFailureNotice } from './clubs-model.js';
import { competitionFailureNotice } from './play-model.js';
import { inviteFailureNotice } from './friends-model.js';

const sanction = (overrides: Partial<Sanction> = {}): Sanction => ({
  id: 'sanction-1',
  kind: 'social_suspension',
  reason: 'harassment',
  statement: 'Your display name impersonated another member.',
  issuedAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-09-08T10:00:00.000Z',
  inForce: true,
  canAppeal: true,
  ...overrides
});

describe('reporting', () => {
  it('offers every published reason, in a stable order, in plain words', () => {
    expect(REPORT_REASONS_IN_ORDER).toHaveLength(7);
    for (const reason of REPORT_REASONS_IN_ORDER)
      expect(REPORT_REASON_LABEL[reason].length).toBeGreaterThan(0);
    expect(REPORT_REASON_LABEL.self_harm).toContain('at risk');
  });

  it('says what a report covers and that no outcome comes back', () => {
    expect(REPORT_CONSEQUENCE_HINT).toContain('a name, a profile, a club');
    expect(REPORT_CONSEQUENCE_HINT).toContain('will not hear the outcome');
    // Blocking and reporting answer different needs, and both stay available.
    expect(REPORT_CONSEQUENCE_HINT).toContain('Blocking is separate');
  });

  it('never claims a report was sent when it was not', () => {
    expect(reportFailureNotice(new ApiFailure(400, 'no'))).toContain('Nothing was sent');
    expect(reportFailureNotice(new AuthFailure('network'))).toContain('Nothing was sent');
    expect(reportFailureNotice(new Error('boom'))).toContain('Nothing was sent');
  });
});

describe('a sanction as the account reads it', () => {
  it('says what it is, whether it applies, and what it actually does', () => {
    const [row] = sanctionRows([sanction()]);

    expect(row?.kindLabel).toBe('Sharing paused');
    expect(row?.statusLabel).toBe('In force');
    expect(row?.endsLabel).toBe('Ends 2026-09-08');
    expect(row?.effectLabel).toContain('Recording, your history, and your export are untouched');
    expect(row?.statement).toBe('Your display name impersonated another member.');
  });

  /** A warning has no end date at all, rather than an undefined one. */
  const warning = (): Sanction => {
    const next = { ...sanction({ kind: 'warning', canAppeal: false }) };
    delete next.expiresAt;
    return next;
  };

  it('describes a warning as a record that changes nothing', () => {
    const [row] = sanctionRows([warning()]);

    expect(row?.kindLabel).toBe('Warning');
    expect(row?.effectLabel).toContain('Nothing has changed');
    expect(row?.endsLabel).toBe('A record, with no end date');
  });

  it('shows an ended sanction rather than dropping it from the record', () => {
    const [row] = sanctionRows([sanction({ inForce: false, canAppeal: false })]);

    expect(row?.statusLabel).toBe('Ended');
  });

  it('reads an appeal decision from the appellant own side', () => {
    const declined = sanctionRows([
      sanction({
        canAppeal: false,
        appeal: {
          id: 'appeal-1',
          status: 'upheld',
          createdAt: '2026-09-02T10:00:00.000Z',
          decidedAt: '2026-09-03T10:00:00.000Z',
          decisionNote: 'The name was still in use.'
        }
      })
    ])[0];
    const accepted = sanctionRows([
      sanction({
        inForce: false,
        canAppeal: false,
        appeal: {
          id: 'appeal-1',
          status: 'overturned',
          createdAt: '2026-09-02T10:00:00.000Z',
          decidedAt: '2026-09-03T10:00:00.000Z',
          decisionNote: 'Mistaken identity.'
        }
      })
    ])[0];
    const waiting = sanctionRows([
      sanction({
        canAppeal: false,
        appeal: {
          id: 'appeal-1',
          status: 'open',
          createdAt: '2026-09-02T10:00:00.000Z',
          decisionNote: ''
        }
      })
    ])[0];

    // "Upheld" is the sanction standing, so it must never read as a win.
    expect(declined?.appealStatusLabel).toBe('Appeal declined. This still applies.');
    expect(accepted?.appealStatusLabel).toBe('Appeal accepted. This no longer applies.');
    expect(waiting?.appealStatusLabel).toContain('waiting for a decision');
  });
});

describe('appealing', () => {
  it('says the one-attempt rule before it is used', () => {
    expect(APPEAL_CONSEQUENCE).toContain('once');
    expect(APPEAL_CONSEQUENCE).toContain('the decision and the reason');
  });

  it('needs words, and not too many of them', () => {
    expect(validateAppeal('  ')).toMatchObject({ ok: false });
    expect(validateAppeal('a'.repeat(2001))).toMatchObject({ ok: false });
    expect(validateAppeal('  It is my surname.  ')).toEqual({
      ok: true,
      statement: 'It is my surname.'
    });
  });

  it('explains a refusal without claiming the appeal went through', () => {
    expect(appealFailureNotice(new ApiFailure(409, 'no'))).toContain('cannot be appealed');
    expect(appealFailureNotice(new ApiFailure(404, 'no'))).toContain('Reload to refresh');
    expect(appealFailureNotice(new AuthFailure('network'))).toContain('Nothing was sent');
    expect(appealFailureNotice(new Error('boom'))).toContain('Nothing was sent');
  });
});

describe('a refusal that is a moderation decision', () => {
  it('shows the statement staff wrote rather than a generic failure', () => {
    const paused = new ApiFailure(403, 'Sharing is paused while we look at your display name.');

    // Every surface a paused account can be refused from tells it why, in the
    // words of the decision.
    expect(inviteFailureNotice(paused)).toBe(
      'Sharing is paused while we look at your display name.'
    );
    expect(clubBoardFailureNotice(paused)).toBe(
      'Sharing is paused while we look at your display name.'
    );
    expect(clubChallengeFailureNotice(paused)).toBe(
      'Sharing is paused while we look at your display name.'
    );
    expect(competitionFailureNotice(paused)).toBe(
      'Sharing is paused while we look at your display name.'
    );
  });
});
