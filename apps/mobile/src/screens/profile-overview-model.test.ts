import { describe, expect, it } from 'vitest';
import type {
  AchievementAward,
  ProgressionSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';
import {
  achievementMedallions,
  humanizeAchievementKey,
  profileStatCells
} from './profile-overview-model.js';

const goal: WeeklyGoalResponse = {
  weekStartsOn: '2026-09-07',
  activeMinutes: { goal: 150, actual: 1_240 },
  distanceMeters: { goal: 20_000, actual: 56_300 }
};

const award = (id: string, achievementKey: string, awardedAt: string): AchievementAward => ({
  id,
  achievementKey,
  ruleVersion: 'v1',
  awardedAt
});

const progression = (overrides: Partial<ProgressionSummary> = {}): ProgressionSummary => ({
  totalXp: 1_240,
  questsCompleted: 0,
  achievements: [],
  ...overrides
});

describe('profile stat cells', () => {
  it('reports the served weekly figures and never labels them a lifetime total', () => {
    const cells = profileStatCells(
      goal,
      progression({
        weeklyConsistency: {
          periodStart: '2026-09-07',
          activeDays: 4,
          cappedActiveMinutes: 120,
          current: true
        },
        achievements: [award('a', 'first_run', '2026-09-01T06:00:00Z')]
      })
    );
    expect(cells.map((cell) => cell.key)).toEqual([
      'distance',
      'active-minutes',
      'xp',
      'active-days',
      'achievements'
    ]);
    expect(cells.find((cell) => cell.key === 'distance')?.value).toBe('56.3 km');
    expect(cells.find((cell) => cell.key === 'active-minutes')?.value).toBe('1,240');
    expect(cells.find((cell) => cell.key === 'active-days')?.value).toBe('4 / 7');
    expect(cells.find((cell) => cell.key === 'achievements')?.label).toBe('Achievement');

    // No cell claims an all-time figure or a ranking the API cannot support.
    for (const cell of cells) {
      expect(cell.label.toLowerCase()).not.toContain('total ');
      expect(cell.label.toLowerCase()).not.toContain('top ');
      expect(cell.label.toLowerCase()).not.toContain('streak');
    }
  });

  it('pluralises the achievement label and clamps an out-of-week day count', () => {
    const cells = profileStatCells(
      goal,
      progression({
        weeklyConsistency: {
          periodStart: '2026-09-07',
          activeDays: 12,
          cappedActiveMinutes: 120,
          current: true
        },
        achievements: [
          award('a', 'first_run', '2026-09-01T06:00:00Z'),
          award('b', 'zone_capturer', '2026-09-02T06:00:00Z')
        ]
      })
    );
    expect(cells.find((cell) => cell.key === 'active-days')?.value).toBe('7 / 7');
    expect(cells.find((cell) => cell.key === 'achievements')?.label).toBe('Achievements');
  });

  it('omits a cell rather than reporting zero for a source that has not loaded', () => {
    expect(profileStatCells(undefined, undefined)).toEqual([]);
    expect(profileStatCells(goal, undefined).map((cell) => cell.key)).toEqual([
      'distance',
      'active-minutes'
    ]);
    // No consistency card means no active-days cell, not a zero.
    expect(profileStatCells(goal, progression()).map((cell) => cell.key)).not.toContain(
      'active-days'
    );
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
