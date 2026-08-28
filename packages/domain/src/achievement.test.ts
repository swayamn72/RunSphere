import { describe, expect, it } from 'vitest';
import {
  bestWeeklyActiveDayCount,
  evaluateAchievements,
  lifetimeCappedActiveMinutes,
  parseAchievementCondition,
  parseAchievementRule,
  type AchievementRule,
  type ScoredActivity
} from './index.js';

const activity = (activeDurationSeconds: number, endedAt: string): ScoredActivity => ({
  activeDurationSeconds,
  endedAt
});

describe('parseAchievementCondition', () => {
  it('accepts every supported pace-neutral kind', () => {
    expect(parseAchievementCondition({ kind: 'completed_activities', min: 1 })).toEqual({
      kind: 'completed_activities',
      min: 1
    });
    expect(parseAchievementCondition({ kind: 'weekly_active_days', min: 3 })).toEqual({
      kind: 'weekly_active_days',
      min: 3
    });
    expect(parseAchievementCondition({ kind: 'lifetime_capped_minutes', min: 420 })).toEqual({
      kind: 'lifetime_capped_minutes',
      min: 420
    });
    expect(parseAchievementCondition({ kind: 'level', min: 3 })).toEqual({ kind: 'level', min: 3 });
  });

  it('rejects malformed conditions', () => {
    expect(() => parseAchievementCondition(null)).toThrow(/object/);
    expect(() => parseAchievementCondition({ kind: 'nearby_runner', min: 1 })).toThrow(/Unknown/);
    expect(() => parseAchievementCondition({ kind: 'weekly_active_days', min: 8 })).toThrow(
      /between 1 and 7/
    );
    expect(() => parseAchievementCondition({ kind: 'level', min: 0 })).toThrow(/min/);
  });
});

describe('parseAchievementRule', () => {
  it('accepts a well-formed definition', () => {
    const rule = {
      key: 'first_steps',
      title: 'First Steps',
      description: 'Complete a validated activity.',
      condition: { kind: 'completed_activities', min: 1 },
      rewardXp: 25
    };
    expect(parseAchievementRule(rule)).toEqual(rule);
  });

  it('rejects missing or invalid display fields', () => {
    expect(() => parseAchievementRule({ ...wellFormed(), key: '' })).toThrow(/key/);
    expect(() => parseAchievementRule({ ...wellFormed(), rewardXp: -1 })).toThrow(/rewardXp/);
  });
});

const wellFormed = (): Record<string, unknown> => ({
  key: 'first_steps',
  title: 'First Steps',
  description: 'Complete a validated activity.',
  condition: { kind: 'completed_activities', min: 1 },
  rewardXp: 25
});

describe('lifetimeCappedActiveMinutes', () => {
  it('caps each local day across the full history', () => {
    const total = lifetimeCappedActiveMinutes(
      [
        activity(360 * 60, '2026-08-24T09:00:00Z'),
        activity(30 * 60, '2026-08-24T10:00:00Z'),
        activity(90 * 60, '2026-08-25T09:00:00Z')
      ],
      60
    );
    expect(total).toBe(120);
  });
});

describe('bestWeeklyActiveDayCount', () => {
  it('takes the maximum across history, reset-safe', () => {
    const best = bestWeeklyActiveDayCount(
      [
        activity(60 * 60, '2026-08-24T09:00:00Z'),
        activity(60 * 60, '2026-08-25T09:00:00Z'),
        activity(60 * 60, '2026-08-26T09:00:00Z'),
        activity(60 * 60, '2026-09-01T09:00:00Z'), // single-day later week
        activity(60 * 60, '2026-08-17T09:00:00Z') // prior week, one day
      ],
      1
    );
    expect(best).toBe(3);
  });
});

describe('evaluateAchievements', () => {
  const baseInput = {
    activities: [] as ScoredActivity[],
    dailyCapMinutes: 240,
    minMinutesPerActiveDay: 1,
    totalXp: 0,
    level: 1
  };

  const rules: AchievementRule[] = [
    {
      key: 'first_steps',
      title: 'First Steps',
      description: '',
      condition: { kind: 'completed_activities', min: 1 },
      rewardXp: 25
    },
    {
      key: 'three_day_rhythm',
      title: 'Three-Day Rhythm',
      description: '',
      condition: { kind: 'weekly_active_days', min: 3 },
      rewardXp: 50
    },
    {
      key: 'level_three',
      title: 'Level Three',
      description: '',
      condition: { kind: 'level', min: 3 },
      rewardXp: 30
    }
  ];

  it('satisfies only the conditions met by the inputs', () => {
    const granted = evaluateAchievements(
      {
        ...baseInput,
        activities: [
          activity(60 * 60, '2026-08-24T09:00:00Z'),
          activity(60 * 60, '2026-08-25T09:00:00Z'),
          activity(60 * 60, '2026-08-26T09:00:00Z')
        ],
        level: 2
      },
      rules
    );
    expect(granted.map((rule) => rule.key).sort()).toEqual(['first_steps', 'three_day_rhythm']);
  });

  it('grants level-based achievements when the level threshold is met', () => {
    const granted = evaluateAchievements({ ...baseInput, level: 3 }, rules);
    expect(granted.map((rule) => rule.key)).toContain('level_three');
  });

  it('grants nothing against an empty history', () => {
    expect(evaluateAchievements(baseInput, rules)).toEqual([]);
  });
});
