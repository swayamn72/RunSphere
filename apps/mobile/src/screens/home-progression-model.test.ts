import { describe, expect, it } from 'vitest';
import type { Profile, ProgressionSummary } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure.js';
import { ApiFailure } from '../api-client.js';
import {
  consistencyPresentation,
  levelPresentation,
  progressionCardState,
  progressionErrorState,
  progressionPresentation,
  progressionStatusMessage
} from './home-progression-model.js';
import { homeStatusMessage } from './home-state.js';

const summary: ProgressionSummary = {
  totalXp: 1240,
  questsCompleted: 0,
  achievements: [],
  weeklyConsistency: {
    periodStart: '2026-08-31',
    activeDays: 3,
    cappedActiveMinutes: 182,
    goalActiveDays: 5,
    current: true
  },
  level: { level: 4, xpInLevel: 90, nextLevelAt: 1400 }
};

const profile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Maya',
  cosmetic: { avatarKey: 'loop-1', tier: 'Trailkeeper' },
  activityVisibility: 'private'
};

describe('Home progression model', () => {
  it('presents the served XP total, level band, and cosmetic tier without deriving anything', () => {
    const presentation = progressionPresentation(summary, profile);
    expect(presentation.totalXpLabel).toBe('1,240 XP');
    expect(presentation.tierLabel).toBe('Trailkeeper');
    // Band start is 1240 - 90 = 1150, so the band spans 1400 - 1150 = 250.
    expect(presentation.level).toEqual({
      levelLabel: 'Level 4',
      xpInLevelLabel: '90 of 250 XP to level 5',
      progress: 36,
      terminal: false,
      progressAccessibilityLabel: 'Level 4, 36% toward level 5'
    });
    expect(progressionCardState(summary)).toBe('ready');
  });

  it('omits the tier when no profile exists rather than inventing an identity', () => {
    const presentation = progressionPresentation(summary, undefined);
    expect(presentation.tierLabel).toBeUndefined();
    expect(presentation.totalXpLabel).toBe('1,240 XP');
  });

  it('drops the progress bar at the top published level instead of showing a full bar', () => {
    const top = levelPresentation({
      ...summary,
      totalXp: 3400,
      level: { level: 10, xpInLevel: 200 }
    });
    expect(top?.terminal).toBe(true);
    expect(top?.progress).toBeUndefined();
    expect(top?.xpInLevelLabel).toBe('200 XP at the top published level');
  });

  it('drops the progress bar when the served band width is not positive', () => {
    const inconsistent = levelPresentation({
      ...summary,
      totalXp: 1240,
      level: { level: 4, xpInLevel: 90, nextLevelAt: 1100 }
    });
    expect(inconsistent?.progress).toBeUndefined();
    expect(inconsistent?.xpInLevelLabel).toBe('90 XP in this level');
    expect(inconsistent?.progressAccessibilityLabel).toMatch(/unavailable/);
  });

  it('treats a missing level as an unpublished rule, not as level zero', () => {
    const withoutRule: ProgressionSummary = {
      totalXp: 0,
      questsCompleted: 0,
      achievements: []
    };
    expect(progressionCardState(withoutRule)).toBe('unpublished');
    expect(levelPresentation(withoutRule)).toBeUndefined();
    expect(consistencyPresentation(withoutRule)).toBeUndefined();
    expect(progressionPresentation(withoutRule, profile).totalXpLabel).toBe('0 XP');
  });

  it('builds seven non-punitive count pips that never claim which days were active', () => {
    const card = consistencyPresentation(summary);
    expect(card?.pips).toHaveLength(7);
    expect(card?.pips.filter((pip) => pip.active)).toHaveLength(3);
    expect(card?.activeDaysLabel).toBe('3 of 7 active days');
    expect(card?.goalLabel).toBe('Goal 5 days');
    expect(card?.cappedMinutesLabel).toBe('182 counted active minutes');
    expect(card?.weekLabel).toBe('This week');
    expect(card?.accessibilityLabel).toBe(
      '3 of 7 active days this week, 182 counted active minutes'
    );
    const copy = [
      card?.activeDaysLabel,
      card?.goalLabel,
      card?.cappedMinutesLabel,
      card?.accessibilityLabel,
      card?.reassurance
    ].join(' ');
    expect(copy).not.toMatch(/miss|fail|lost|broke|streak|mon|tue|wed|thu|fri|sat|sun/i);
  });

  it('labels a non-current consistency period by its week instead of calling it this week', () => {
    const card = consistencyPresentation({
      ...summary,
      weeklyConsistency: {
        periodStart: '2026-08-24',
        activeDays: 0,
        cappedActiveMinutes: 0,
        current: false
      }
    });
    expect(card?.weekLabel).toBe('Week of 2026-08-24');
    expect(card?.goalLabel).toBeUndefined();
    expect(card?.pips.some((pip) => pip.active)).toBe(false);
    expect(card?.activeDaysLabel).toBe('0 of 7 active days');
  });

  it('clamps an out-of-range active-day count to the seven available pips', () => {
    const card = consistencyPresentation({
      ...summary,
      weeklyConsistency: {
        periodStart: '2026-08-31',
        activeDays: 9,
        cappedActiveMinutes: 0,
        current: true
      }
    });
    expect(card?.pips.filter((pip) => pip.active)).toHaveLength(7);
  });

  it('separates an unconfigured deployment, an offline device, and an expired session', () => {
    expect(progressionErrorState(new ApiFailure(503, 'unavailable'))).toBe('unavailable');
    expect(progressionErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(progressionErrorState(new AuthFailure('network'))).toBe('offline');
    expect(progressionErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(progressionErrorState(new ApiFailure(500, 'boom'))).toBe('error');
    expect(progressionErrorState(new Error('boom'))).toBe('error');
  });

  it('announces progression only when the weekly goal and quest list are both fine', () => {
    expect(progressionStatusMessage('unavailable')).toMatch(/not available on this server/);
    expect(progressionStatusMessage('ready')).toBe('');
    expect(progressionStatusMessage('unpublished')).toBe('');
    expect(homeStatusMessage('ready', 'ready', progressionStatusMessage('offline'))).toBe(
      'Progression is unavailable offline.'
    );
    expect(homeStatusMessage('offline', 'ready', progressionStatusMessage('offline'))).toBe(
      'Some Home data is unavailable offline.'
    );
    expect(homeStatusMessage('ready', 'ready')).toBe('');
  });

  it('never surfaces the stubbed server quest-completion count', () => {
    const presentation = progressionPresentation({ ...summary, questsCompleted: 0 }, profile);
    expect(JSON.stringify(presentation)).not.toMatch(/quest/i);
    expect(JSON.stringify(consistencyPresentation(summary))).not.toMatch(/quest/i);
  });
});
