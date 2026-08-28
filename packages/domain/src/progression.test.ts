import { describe, expect, it } from 'vitest';
import {
  parseProgressionRule,
  weeklyXpGrants,
  xpLevel,
  type ProgressionRule
} from './progression.js';
import type { ScoredActivity } from './gamification.js';

const rule: ProgressionRule = {
  xpPerActiveMinute: 1,
  xpPerActiveDay: 20,
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  goalActiveDays: 3,
  levels: [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]
};

const activity = (activeDurationSeconds: number, endedAt: string): ScoredActivity => ({
  activeDurationSeconds,
  endedAt
});

describe('parseProgressionRule', () => {
  it('accepts a well-formed rule payload', () => {
    expect(parseProgressionRule(rule)).toEqual(rule);
  });

  it('rejects a missing field', () => {
    const missing: Record<string, unknown> = { ...rule };
    delete missing.xpPerActiveMinute;
    expect(() => parseProgressionRule(missing)).toThrow(/xpPerActiveMinute/);
  });

  it('rejects an out-of-range field', () => {
    expect(() => parseProgressionRule({ ...rule, goalActiveDays: 8 })).toThrow(/goalActiveDays/);
    expect(() => parseProgressionRule({ ...rule, levels: [] })).toThrow(/levels/);
    expect(() => parseProgressionRule({ ...rule, levels: [0, -1] })).toThrow(/levels\[1\]/);
  });

  it('rejects non-object definitions', () => {
    expect(() => parseProgressionRule(null)).toThrow(/object/);
    expect(() => parseProgressionRule('progression')).toThrow(/object/);
  });
});

describe('weeklyXpGrants', () => {
  const weekStart = new Date('2026-08-23T18:30:00Z'); // Monday 2026-08-24

  it('scores per-week minutes and active days with dedupe keys', () => {
    const grants = weeklyXpGrants(
      [
        activity(90 * 60, '2026-08-24T09:00:00Z'), // 90 capped minutes
        activity(30 * 60, '2026-08-25T09:00:00Z'), // 30 capped minutes
        activity(60 * 60, '2026-08-26T09:00:00Z') // 60 capped minutes
      ],
      rule,
      weekStart
    );
    expect(grants).toEqual([
      {
        source: 'active_minutes',
        amount: 180,
        periodStart: '2026-08-24',
        dedupeKey: 'active_minutes:2026-08-24'
      },
      {
        source: 'active_day_consistency',
        amount: 60,
        periodStart: '2026-08-24',
        dedupeKey: 'active_day_consistency:2026-08-24'
      }
    ]);
  });

  it('omits zero-amount grants', () => {
    const grants = weeklyXpGrants([], rule, weekStart);
    expect(grants).toEqual([]);
  });

  it('ignores activities outside the week boundary', () => {
    const grants = weeklyXpGrants(
      [activity(60 * 60, '2026-08-31T00:00:00Z')], // next Monday
      rule,
      weekStart
    );
    expect(grants).toEqual([]);
  });

  it('caps a single day at the configured daily cap', () => {
    const grants = weeklyXpGrants([activity(360 * 60, '2026-08-24T09:00:00Z')], rule, weekStart);
    expect(grants).toContainEqual({
      source: 'active_minutes',
      amount: 240,
      periodStart: '2026-08-24',
      dedupeKey: 'active_minutes:2026-08-24'
    });
  });
});

describe('xpLevel', () => {
  it('starts at level 1 with zero XP', () => {
    expect(xpLevel(0, rule.levels)).toEqual({ level: 1, xpInLevel: 0, nextLevelAt: 100 });
  });

  it('advances through intermediate thresholds', () => {
    expect(xpLevel(150, rule.levels)).toEqual({ level: 2, xpInLevel: 50, nextLevelAt: 250 });
  });

  it('caps at the terminal level without a next threshold', () => {
    expect(xpLevel(3200, rule.levels)).toEqual({ level: 10, xpInLevel: 0 });
    expect(xpLevel(4000, rule.levels)).toEqual({ level: 10, xpInLevel: 800 });
  });
});
