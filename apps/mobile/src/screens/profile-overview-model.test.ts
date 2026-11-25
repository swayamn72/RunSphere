import { describe, expect, it } from 'vitest';
import type { AchievementAward } from '@runsphere/contracts';
import {
  achievementMedallions,
  humanizeAchievementKey,
  profileStatCells
} from './profile-overview-model.js';

const award = (id: string, achievementKey: string, awardedAt: string): AchievementAward => ({
  id,
  achievementKey,
  ruleVersion: 'v1',
  awardedAt
});

describe('profile stat cells', () => {
  it('shows confirmed Turf points when the summary is available', () => {
    expect(profileStatCells({ claimCount: 2, totalAreaSqm: 12000, lostCount: 1 })).toEqual([
      { key: 'held', label: 'Turf held', value: '120 Turf points' }
    ]);
    expect(profileStatCells(undefined)).toEqual([]);
  });
});

describe('achievement medallions', () => {
  it('humanises the served key rather than inventing a title', () => {
    expect(humanizeAchievementKey('first_run')).toBe('First run');
    expect(humanizeAchievementKey('zone-capturer')).toBe('Zone capturer');
    expect(humanizeAchievementKey('seven__day_streak')).toBe('Seven day streak');
    expect(humanizeAchievementKey('')).toBe('Achievement');
  });

  it('leads with the most recent award and keeps the strip to its limit', () => {
    const medallions = achievementMedallions([
      award('a', 'first_run', '2026-09-01T06:00:00Z'),
      award('c', 'zone_capturer', '2026-09-09T06:00:00Z'),
      award('b', 'early_bird', '2026-09-05T06:00:00Z'),
      award('d', 'night_owl', '2026-08-20T06:00:00Z')
    ]);
    expect(medallions.map((entry) => entry.key)).toEqual(['c', 'b', 'a']);
    expect(medallions[0]?.achievementKey).toBe('zone_capturer');
    expect(medallions[0]?.label).toBe('Zone capturer');
    expect(medallions[0]?.awardedOn).toBe('2026-09-09');
    expect(medallions[0]?.accessibilityLabel).toBe('Zone capturer. Earned on 2026-09-09.');
  });

  it('survives an unparseable award date without rendering an invalid one', () => {
    const [medallion] = achievementMedallions([award('a', 'first_run', 'not-a-date')]);
    expect(medallion?.awardedOn).toBeUndefined();
    expect(medallion?.accessibilityLabel).toBe('First run. Earned.');
  });

  it('has nothing to show before anything has been awarded', () => {
    expect(achievementMedallions([])).toEqual([]);
  });
});
