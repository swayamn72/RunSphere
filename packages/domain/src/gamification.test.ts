import { describe, expect, it } from 'vitest';
import {
  activeDayCount,
  cappedActiveMinutes,
  challengeModeScore,
  dailyValidatedActiveMinutes,
  kolkataDate,
  questCompletionCount,
  weeklyActiveDayCount,
  weeklyConsistency,
  weeklyPeriodStart,
  type ScoredActivity
} from './gamification.js';

const activity = (activeDurationSeconds: number, endedAt: string): ScoredActivity => ({
  activeDurationSeconds,
  endedAt
});

describe('kolkataDate', () => {
  it('maps UTC instants across the fixed +05:30 offset boundary', () => {
    expect(kolkataDate(new Date('2026-08-23T18:30:00Z'))).toBe('2026-08-24');
    expect(kolkataDate(new Date('2026-08-23T18:29:59Z'))).toBe('2026-08-23');
    expect(kolkataDate(new Date('2026-08-28T16:00:00Z'))).toBe('2026-08-28');
  });
});

describe('weeklyPeriodStart', () => {
  it('anchors the week to Asia/Kolkata Monday 00:00', () => {
    expect(weeklyPeriodStart(new Date('2026-08-28T16:00:00Z')).toISOString()).toBe(
      '2026-08-23T18:30:00.000Z'
    );
  });

  it('includes the Monday boundary instant in the new week', () => {
    expect(weeklyPeriodStart(new Date('2026-08-23T18:30:00Z')).toISOString()).toBe(
      '2026-08-23T18:30:00.000Z'
    );
  });

  it('rolls back one week for the instant just before the boundary', () => {
    expect(weeklyPeriodStart(new Date('2026-08-23T18:29:59Z')).toISOString()).toBe(
      '2026-08-16T18:30:00.000Z'
    );
  });

  it('rolls across the year boundary deterministically', () => {
    expect(weeklyPeriodStart(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe(
      '2025-12-28T18:30:00.000Z'
    );
  });
});

describe('dailyValidatedActiveMinutes', () => {
  it('groups by Kolkata date and floors to whole minutes', () => {
    const daily = dailyValidatedActiveMinutes([
      activity(90, '2026-08-24T09:00:00Z'),
      activity(59, '2026-08-24T10:00:00Z'),
      activity(120, '2026-08-25T09:00:00Z'),
      activity(30, '2026-08-23T18:00:00Z')
    ]);
    expect(daily.get('2026-08-24')).toBe(1);
    expect(daily.get('2026-08-25')).toBe(2);
    expect(daily.get('2026-08-23')).toBe(0);
  });
});

describe('cappedActiveMinutes', () => {
  const start = new Date('2026-08-23T18:30:00Z'); // Monday 2026-08-24
  const end = new Date('2026-08-30T18:30:00Z'); // Monday 2026-08-31

  it('caps each local day and ignores out-of-window activity', () => {
    const total = cappedActiveMinutes(
      [
        activity(360 * 60, '2026-08-24T09:00:00Z'),
        activity(30 * 60, '2026-08-24T10:00:00Z'),
        activity(20 * 60, '2026-08-25T09:00:00Z'),
        activity(60 * 60, '2026-08-31T09:00:00Z')
      ],
      start,
      end,
      60
    );
    expect(total).toBe(80);
  });

  it('treats a single day as a single capped unit', () => {
    const total = cappedActiveMinutes([activity(120 * 60, '2026-08-24T09:00:00Z')], start, end, 60);
    expect(total).toBe(60);
  });
});

describe('activeDayCount', () => {
  const start = new Date('2026-08-23T18:30:00Z');
  const end = new Date('2026-08-30T18:30:00Z');

  it('counts distinct days reaching the minute threshold once each', () => {
    const days = activeDayCount(
      [
        activity(120, '2026-08-24T09:00:00Z'),
        activity(120, '2026-08-24T11:00:00Z'),
        activity(30, '2026-08-25T09:00:00Z'),
        activity(60, '2026-08-26T09:00:00Z')
      ],
      start,
      end
    );
    expect(days).toBe(2);
  });

  it('honors a custom active-day threshold', () => {
    expect(weeklyActiveDayCount([activity(2 * 60, '2026-08-24T09:00:00Z')], start, 2)).toBe(1);
    expect(weeklyActiveDayCount([activity(1 * 60, '2026-08-24T09:00:00Z')], start, 2)).toBe(0);
  });
});

describe('weeklyConsistency', () => {
  const now = new Date('2026-08-28T12:00:00Z');

  it('builds a current, capped card for the week containing now', () => {
    const card = weeklyConsistency(
      [activity(2 * 60, '2026-08-24T09:00:00Z'), activity(3 * 60, '2026-08-25T09:00:00Z')],
      { now, dailyCapMinutes: 120, goalActiveDays: 5 }
    );
    expect(card).toEqual({
      periodStart: '2026-08-24',
      activeDays: 2,
      cappedActiveMinutes: 5,
      goalActiveDays: 5,
      current: true
    });
  });

  it('marks a past week as not current when an explicit period is supplied', () => {
    const card = weeklyConsistency([], {
      now,
      periodStart: new Date('2026-08-16T18:30:00Z')
    });
    expect(card.periodStart).toBe('2026-08-17');
    expect(card.current).toBe(false);
    expect(card.activeDays).toBe(0);
    expect(card.cappedActiveMinutes).toBe(0);
  });
});

describe('questCompletionCount', () => {
  it('counts completions strictly within the window', () => {
    const count = questCompletionCount(
      [
        { completedAt: '2026-08-25T12:00:00Z' },
        { completedAt: '2026-08-26T12:00:00Z' },
        { completedAt: '2026-08-28T12:00:00Z' }
      ],
      new Date('2026-08-24T18:30:00Z'),
      new Date('2026-08-27T18:30:00Z')
    );
    expect(count).toBe(2);
  });
});

describe('challengeModeScore', () => {
  const window = {
    periodStart: new Date('2026-08-24T18:30:00Z'), // Kolkata 2026-08-25
    periodEnd: new Date('2026-08-27T18:30:00Z') // Kolkata 2026-08-28
  };

  it('scores active minutes with per-day caps', () => {
    const score = challengeModeScore(
      'active_minutes',
      window,
      [activity(200 * 60, '2026-08-25T09:00:00Z'), activity(10 * 60, '2026-08-26T09:00:00Z')],
      [],
      60
    );
    expect(score).toBe(70);
  });

  it('scores active days independently of duration', () => {
    const score = challengeModeScore(
      'active_days',
      window,
      [activity(1 * 60, '2026-08-25T09:00:00Z'), activity(500 * 60, '2026-08-26T09:00:00Z')],
      [],
      60
    );
    expect(score).toBe(2);
  });

  it('scores quest completions from the completion stream', () => {
    const score = challengeModeScore(
      'quest_completion',
      window,
      [],
      [{ completedAt: '2026-08-25T12:00:00Z' }, { completedAt: '2026-08-26T12:00:00Z' }],
      60
    );
    expect(score).toBe(2);
  });
});
