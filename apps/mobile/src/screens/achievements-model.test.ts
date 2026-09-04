import { describe, expect, it } from 'vitest';
import type { AchievementStatus } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import {
  achievementRows,
  achievementsErrorState,
  achievementsState,
  achievementsStatusMessage,
  achievementsSummary,
  awardedDate,
  syncFailureNotice,
  syncNotice
} from './achievements-model';

const achievement = (overrides: Partial<AchievementStatus> = {}): AchievementStatus => ({
  key: 'first-walk',
  ruleVersion: '1',
  title: 'First steps',
  description: 'Record one validated walk.',
  rewardXp: 20,
  earned: false,
  ...overrides
});

describe('rows', () => {
  it('puts earned achievements first, most recent at the top', () => {
    const rows = achievementRows([
      achievement({ key: 'c', title: 'Chi' }),
      achievement({ key: 'a', title: 'Alpha', earned: true, awardedAt: '2026-09-01T10:00:00Z' }),
      achievement({ key: 'b', title: 'Beta', earned: true, awardedAt: '2026-09-03T10:00:00Z' })
    ]);
    expect(rows.map((row) => row.key)).toEqual(['b', 'a', 'c']);
  });

  it('sorts the unearned alphabetically, so the list is stable between loads', () => {
    const rows = achievementRows([
      achievement({ key: 'z', title: 'Zephyr' }),
      achievement({ key: 'm', title: 'Middle' })
    ]);
    expect(rows.map((row) => row.key)).toEqual(['m', 'z']);
  });

  it('states the earned date on the Asia/Kolkata day the server scored', () => {
    const [row] = achievementRows([
      achievement({ earned: true, awardedAt: '2026-09-03T19:30:00.000Z' })
    ]);
    // 19:30Z is past midnight IST, so the award lands on the 4th.
    expect(row!.earnedOn).toBe('2026-09-04');
    expect(row!.accessibilityLabel).toContain('Earned on 2026-09-04.');
  });

  it('says an unearned achievement is not earned yet, never that it is close', () => {
    const [row] = achievementRows([achievement()]);
    expect(row!.earned).toBe(false);
    expect(row!.earnedOn).toBeUndefined();
    expect(row!.accessibilityLabel).toContain('Not earned yet.');
    expect(row!.accessibilityLabel).not.toMatch(/progress|almost|nearly/i);
  });

  it('names the reward as cosmetic XP, and says so when there is none', () => {
    expect(achievementRows([achievement({ rewardXp: 20 })])[0]!.rewardLabel).toBe('20 cosmetic XP');
    expect(achievementRows([achievement({ rewardXp: 0 })])[0]!.rewardLabel).toBe('No XP');
  });

  it('tolerates an earned award with no or an unusable timestamp', () => {
    expect(awardedDate(undefined)).toBeUndefined();
    expect(awardedDate('not a date')).toBeUndefined();
    const [row] = achievementRows([achievement({ earned: true })]);
    expect(row!.accessibilityLabel).toContain('Earned.');
  });
});

describe('summary', () => {
  it('counts earned out of published', () => {
    expect(achievementsSummary([achievement({ earned: true }), achievement({ key: 'b' })])).toBe(
      '1 of 2 earned'
    );
    expect(achievementsSummary([])).toBe('0 of 0 earned');
  });
});

describe('sync', () => {
  it('reports only what the server says it awarded', () => {
    expect(syncNotice(0)).toBe('Nothing new to award yet.');
    expect(syncNotice(1)).toBe('One new achievement.');
    expect(syncNotice(3)).toBe('3 new achievements.');
  });

  it('says nothing changed when the check could not run', () => {
    expect(syncFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(syncFailureNotice(new Error('boom'))).toContain('Nothing changed');
  });
});

describe('state and status', () => {
  it('is empty when the deployment publishes no rules', () => {
    expect(achievementsState([])).toBe('empty');
    expect(achievementsState([achievement()])).toBe('ready');
  });

  it('maps transport failures the way every other screen does', () => {
    expect(achievementsErrorState(new AuthFailure('network'))).toBe('offline');
    expect(achievementsErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(achievementsErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(achievementsErrorState(new Error('boom'))).toBe('error');
  });

  it('announces the count once loaded, and a notice ahead of it', () => {
    const list = [achievement({ earned: true }), achievement({ key: 'b' })];
    expect(achievementsStatusMessage('ready', '', list)).toBe('1 of 2 earned');
    expect(achievementsStatusMessage('ready', 'One new achievement.', list)).toBe(
      'One new achievement.'
    );
    expect(achievementsStatusMessage('offline', '', list)).toContain('offline');
  });
});
