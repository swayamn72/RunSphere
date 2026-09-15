import { describe, expect, it } from 'vitest';
import type { Profile, ProgressionSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import {
  activeDaysPresentation,
  dashboardTiles,
  greetingPresentation,
  timeOfDay,
  QUICK_ACTIONS
} from './home-dashboard-model.js';

const profile = (displayName: string): Profile =>
  ({
    id: '7f0d1b9c-3a4e-4b0a-8f2d-1e5c6a7b8c9d',
    displayName,
    cosmetic: { avatarKey: 'loop-home' },
    activityVisibility: 'private'
  }) as Profile;

const goal: WeeklyGoalResponse = {
  weekStartsOn: '2026-09-07',
  activeMinutes: { goal: 150, actual: 1_240 },
  distanceMeters: { goal: 20_000, actual: 56_300 }
};

const progression = (overrides: Partial<ProgressionSummary> = {}): ProgressionSummary => ({
  totalXp: 1_240,
  questsCompleted: 0,
  achievements: [],
  ...overrides
});

describe('home dashboard greeting', () => {
  it('reads the greeting from the hour rather than a fixed string', () => {
    expect(timeOfDay(6)).toBe('morning');
    expect(timeOfDay(11)).toBe('morning');
    expect(timeOfDay(12)).toBe('afternoon');
    expect(timeOfDay(16)).toBe('afternoon');
    expect(timeOfDay(17)).toBe('evening');
    expect(timeOfDay(23)).toBe('evening');
  });

  it('keeps an out-of-range or unusable hour on a safe greeting', () => {
    expect(timeOfDay(-1)).toBe('evening');
    expect(timeOfDay(25)).toBe('morning');
    expect(timeOfDay(Number.NaN)).toBe('morning');
  });

  it('greets by name and builds a monogram from at most two words', () => {
    expect(greetingPresentation(profile('Swayam Nakte'), 9)).toEqual({
      salutation: 'Good morning,',
      name: 'Swayam Nakte!',
      initials: 'SN'
    });
    expect(greetingPresentation(profile('Tanmay'), 19).initials).toBe('T');
    expect(greetingPresentation(profile('ada lovelace king'), 13).initials).toBe('AL');
  });

  it('never invents a name or an initial from an absent profile', () => {
    const absent = greetingPresentation(undefined, 9);
    expect(absent.name).toBe('Runner!');
    expect(absent.initials).toBe('·');
    expect(greetingPresentation(profile('   '), 9).name).toBe('Runner!');
  });
});

describe('active days meter', () => {
  it('fills one pip per active day and speaks a count, never a weekday', () => {
    const card = activeDaysPresentation(
      progression({
        weeklyConsistency: {
          periodStart: '2026-09-07',
          activeDays: 3,
          cappedActiveMinutes: 90,
          current: true
        }
      })
    );
    expect(card?.value).toBe('3');
    expect(card?.caption).toBe('Active days this week');
    expect(card?.pips).toHaveLength(7);
    expect(card?.pips.filter((pip) => pip.active)).toHaveLength(3);
    expect(card?.pips.slice(0, 3).every((pip) => pip.active)).toBe(true);
    expect(card?.accessibilityLabel).toBe('3 of 7 days active this week.');
    // No weekday name appears anywhere: the server reports the count only.
    for (const day of ['Mon', 'Monday', 'Tue', 'Sunday'])
      expect(card?.accessibilityLabel).not.toContain(day);
  });

  it('singularises one active day and clamps a count outside the week', () => {
    const one = activeDaysPresentation(
      progression({
        weeklyConsistency: {
          periodStart: '2026-09-07',
          activeDays: 1,
          cappedActiveMinutes: 30,
          current: true
        }
      })
    );
    expect(one?.caption).toBe('Active day this week');
    const over = activeDaysPresentation(
      progression({
        weeklyConsistency: {
          periodStart: '2026-09-07',
          activeDays: 99,
          cappedActiveMinutes: 30,
          current: true
        }
      })
    );
    expect(over?.pips.filter((pip) => pip.active)).toHaveLength(7);
  });

  it('shows no meter at all when the server sent no consistency card', () => {
    expect(activeDaysPresentation(progression())).toBeUndefined();
    expect(activeDaysPresentation(undefined)).toBeUndefined();
  });
});

describe('dashboard tiles', () => {
  it('reports the server figures with grouped thousands', () => {
    const tiles = dashboardTiles(goal, progression({ level: { level: 8, xpInLevel: 40 } }));
    expect(tiles.map((tile) => tile.key)).toEqual(['distance', 'active-minutes', 'xp', 'level']);
    expect(tiles.find((tile) => tile.key === 'distance')?.value).toBe('56.3');
    expect(tiles.find((tile) => tile.key === 'active-minutes')?.value).toBe('1,240');
    expect(tiles.find((tile) => tile.key === 'xp')?.value).toBe('1,240');
    expect(tiles.find((tile) => tile.key === 'level')?.value).toBe('8');
  });

  it('omits a tile rather than reporting zero for a source that has not loaded', () => {
    expect(dashboardTiles(undefined, undefined)).toEqual([]);
    expect(dashboardTiles(goal, undefined).map((tile) => tile.key)).toEqual([
      'distance',
      'active-minutes'
    ]);
    // An unpublished level band is unknown, not level 1.
    expect(dashboardTiles(goal, progression()).map((tile) => tile.key)).not.toContain('level');
  });

  it('never presents a figure the product does not measure', () => {
    const labels = dashboardTiles(goal, progression({ level: { level: 8, xpInLevel: 40 } })).map(
      (tile) => tile.label
    );
    for (const absent of ['CALORIES', 'KCAL', 'STREAK', 'ZONES CAPTURED', 'RUNS'])
      expect(labels).not.toContain(absent);
  });
});

describe('quick actions', () => {
  it('offers the three fixed actions in order, each with a distinct glyph', () => {
    expect(QUICK_ACTIONS.map((action) => action.key)).toEqual(['run', 'map', 'social']);
    expect(new Set(QUICK_ACTIONS.map((action) => action.glyph)).size).toBe(3);
  });
});
