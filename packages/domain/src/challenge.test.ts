import { describe, expect, it } from 'vitest';
import {
  challengeLengthEnabled,
  challengeModeEnabled,
  parseChallengeRule,
  type ChallengeRule
} from './challenge.js';
import {
  challengeModeScore,
  challengeWindow,
  challengeWinner,
  competitionRanking,
  kolkataDateStart,
  kolkataDayStart,
  type ScoredActivity
} from './gamification.js';

const definition = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 5,
  lengthDays: [3, 7],
  modes: ['active_minutes', 'active_days']
};

const rule: ChallengeRule = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 5,
  lengthDays: [3, 7],
  modes: ['active_minutes', 'active_days']
};

const activity = (activeDurationSeconds: number, endedAt: string): ScoredActivity => ({
  activeDurationSeconds,
  endedAt
});

describe('parseChallengeRule', () => {
  it('accepts a well-formed rule payload', () => {
    expect(parseChallengeRule(definition)).toEqual(rule);
  });

  it('reports which modes and lengths a published rule actually enables', () => {
    expect(challengeModeEnabled(rule, 'active_minutes')).toBe(true);
    expect(challengeModeEnabled(rule, 'active_days')).toBe(true);
    // Not derivable server-side yet, so the rule must not claim it is scoreable.
    expect(challengeModeEnabled(rule, 'quest_completion')).toBe(false);
    expect(challengeLengthEnabled(rule, 3)).toBe(true);
    expect(challengeLengthEnabled(rule, 7)).toBe(true);
    expect(challengeLengthEnabled(rule, 30)).toBe(false);
  });

  it('accepts an empty mode list as a rule that disables challenges outright', () => {
    expect(parseChallengeRule({ ...definition, modes: [] }).modes).toEqual([]);
  });

  it('fails loudly rather than scoring every challenge as a tie', () => {
    expect(() => parseChallengeRule(null)).toThrow(/JSON object/);
    expect(() => parseChallengeRule({ ...definition, dailyCapMinutes: 0 })).toThrow(
      /dailyCapMinutes/
    );
    expect(() => parseChallengeRule({ ...definition, minMinutesPerActiveDay: 1.5 })).toThrow(
      /minMinutesPerActiveDay/
    );
    expect(() => parseChallengeRule({ ...definition, lengthDays: [] })).toThrow(/lengthDays/);
    expect(() => parseChallengeRule({ ...definition, lengthDays: [0] })).toThrow(/lengthDays\[0\]/);
    expect(() => parseChallengeRule({ ...definition, modes: ['pace'] })).toThrow(/modes\[0\]/);
    expect(() => parseChallengeRule({ ...definition, modes: 'active_days' })).toThrow(/modes/);
  });
});

describe('challenge windows', () => {
  it('converts a stored Kolkata date back to the exact instant its window opened', () => {
    // 2026-08-31 00:00 Asia/Kolkata is 2026-08-30T18:30:00Z.
    expect(kolkataDateStart('2026-08-31').toISOString()).toBe('2026-08-30T18:30:00.000Z');
    expect(kolkataDayStart(new Date('2026-08-31T04:00:00Z')).toISOString()).toBe(
      '2026-08-30T18:30:00.000Z'
    );
    // 22:30 Kolkata on 2026-08-30 still belongs to the 2026-08-30 calendar day.
    expect(kolkataDayStart(new Date('2026-08-30T17:00:00Z')).toISOString()).toBe(
      '2026-08-29T18:30:00.000Z'
    );
  });

  it('spans exactly the published number of Kolkata days', () => {
    const window = challengeWindow('2026-08-31', 3);
    expect(window.periodStart.toISOString()).toBe('2026-08-30T18:30:00.000Z');
    expect(window.periodEnd.toISOString()).toBe('2026-09-02T18:30:00.000Z');
    expect(challengeWindow('2026-08-31', 7).periodEnd.toISOString()).toBe(
      '2026-09-06T18:30:00.000Z'
    );
  });

  it('rejects a malformed date or length instead of producing an invalid window', () => {
    expect(() => challengeWindow('31-08-2026', 3)).toThrow(/YYYY-MM-DD/);
    expect(() => challengeWindow('2026-08-31', 0)).toThrow(/positive whole number/);
  });
});

describe('challenge scoring', () => {
  const window = challengeWindow('2026-08-31', 3);

  it('scores capped active minutes inside the window and ignores activity outside it', () => {
    const activities = [
      activity(90 * 60, '2026-08-31T09:00:00Z'), // 90 min, capped to 240 for the day
      activity(30 * 60, '2026-08-31T18:00:00Z'), // same Kolkata day
      activity(60 * 60, '2026-09-05T09:00:00Z') // after the window closes
    ];
    expect(challengeModeScore('active_minutes', window, activities, [], rule.dailyCapMinutes)).toBe(
      120
    );
  });

  it('applies the published per-day cap rather than the provisional default', () => {
    const activities = [activity(300 * 60, '2026-08-31T09:00:00Z')];
    expect(challengeModeScore('active_minutes', window, activities, [], 60)).toBe(60);
  });

  it('honours the published minimum minutes before a day counts as active', () => {
    const activities = [
      activity(2 * 60, '2026-08-31T09:00:00Z'), // 2 min: below a 5-minute minimum
      activity(20 * 60, '2026-09-01T09:00:00Z')
    ];
    expect(challengeModeScore('active_days', window, activities, [], rule.dailyCapMinutes, 5)).toBe(
      1
    );
    // The default keeps the pre-existing one-minute behaviour for other callers.
    expect(challengeModeScore('active_days', window, activities, [], rule.dailyCapMinutes)).toBe(2);
  });
});

describe('competitionRanking', () => {
  it('shares a rank for equal scores and skips the positions they consumed', () => {
    expect(competitionRanking([200, 120, 120, 45])).toEqual([1, 2, 2, 4]);
    expect(competitionRanking([10, 10, 10])).toEqual([1, 1, 1]);
    expect(competitionRanking([5, 4, 3, 2, 1])).toEqual([1, 2, 3, 4, 5]);
  });

  it('ranks an all-zero board as a single shared first place, not as unranked', () => {
    expect(competitionRanking([0, 0, 0])).toEqual([1, 1, 1]);
  });

  it('has no ranks without entries', () => {
    expect(competitionRanking([])).toEqual([]);
  });
});

describe('challengeWinner', () => {
  it('awards the higher pace-neutral score', () => {
    expect(
      challengeWinner([
        { accountId: 'a', score: 120 },
        { accountId: 'b', score: 95 }
      ])
    ).toBe('a');
    expect(
      challengeWinner([
        { accountId: 'a', score: 95 },
        { accountId: 'b', score: 120 }
      ])
    ).toBe('b');
  });

  it('leaves an exact tie without a winner instead of breaking it on pace or time', () => {
    expect(
      challengeWinner([
        { accountId: 'a', score: 100 },
        { accountId: 'b', score: 100 }
      ])
    ).toBeUndefined();
    expect(
      challengeWinner([
        { accountId: 'a', score: 0 },
        { accountId: 'b', score: 0 }
      ])
    ).toBeUndefined();
  });

  it('has no winner without participants', () => {
    expect(challengeWinner([])).toBeUndefined();
  });
});
