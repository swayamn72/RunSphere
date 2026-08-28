import { TypeSystem } from '@sinclair/typebox/system';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  ChallengeLengthDaysSchema,
  InboxEntrySchema,
  LevelInfoSchema,
  ProfileSchema,
  ProgressionRuleSchema,
  ProgressionSummarySchema,
  WeeklyConsistencySchema
} from './index.js';

// The standalone Value runtime does not ship JSON Schema format validators;
// production enforces these through Fastify/AJV. Register the equivalents here
// so the contract tests can exercise the full schema.
TypeSystem.Format('uuid', (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
);
TypeSystem.Format('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
TypeSystem.Format('date-time', (value) => !Number.isNaN(Date.parse(value)));

describe('gamification contracts', () => {
  it('ProfileSchema accepts a privacy-minimized display identity and rejects invalid visibility', () => {
    const valid = {
      id: '7f0d1b9c-3a4e-4b0a-8f2d-1e5c6a7b8c9d',
      displayName: 'Runner',
      cosmetic: { avatarKey: 'loop-home' },
      activityVisibility: 'private'
    };
    expect(Value.Check(ProfileSchema, valid)).toBe(true);
    expect(Value.Check(ProfileSchema, { ...valid, activityVisibility: 'public' })).toBe(false);
  });

  it('ChallengeLengthDaysSchema only allows 3 or 7 day windows', () => {
    expect(Value.Check(ChallengeLengthDaysSchema, 3)).toBe(true);
    expect(Value.Check(ChallengeLengthDaysSchema, 7)).toBe(true);
    expect(Value.Check(ChallengeLengthDaysSchema, 5)).toBe(false);
  });

  it('InboxEntrySchema rejects unknown notification kinds', () => {
    const base = {
      id: '7f0d1b9c-3a4e-4b0a-8f2d-1e5c6a7b8c9d',
      kind: 'friend_request',
      title: 'Friend request',
      body: 'Someone wants to connect',
      createdAt: new Date().toISOString()
    };
    expect(Value.Check(InboxEntrySchema, base)).toBe(true);
    expect(Value.Check(InboxEntrySchema, { ...base, kind: 'nearby_runner' })).toBe(false);
  });

  it('WeeklyConsistencySchema bounds activeDays to a single week', () => {
    const base = {
      periodStart: '2026-08-24',
      activeDays: 3,
      cappedActiveMinutes: 120,
      current: true
    };
    expect(Value.Check(WeeklyConsistencySchema, base)).toBe(true);
    expect(Value.Check(WeeklyConsistencySchema, { ...base, activeDays: 8 })).toBe(false);
  });

  it('ProgressionRuleSchema requires cumulative levels and accepts zero-rate fields', () => {
    const base = {
      xpPerActiveMinute: 1,
      xpPerActiveDay: 20,
      dailyCapMinutes: 240,
      minMinutesPerActiveDay: 1,
      goalActiveDays: 3,
      levels: [0, 100, 250]
    };
    expect(Value.Check(ProgressionRuleSchema, base)).toBe(true);
    expect(Value.Check(ProgressionRuleSchema, { ...base, levels: [] })).toBe(false);
    expect(Value.Check(ProgressionRuleSchema, { ...base, dailyCapMinutes: 0 })).toBe(false);
    expect(Value.Check(ProgressionRuleSchema, { ...base, goalActiveDays: 8 })).toBe(false);
  });

  it('LevelInfoSchema omits nextLevelAt at the terminal level', () => {
    expect(Value.Check(LevelInfoSchema, { level: 3, xpInLevel: 40, nextLevelAt: 250 })).toBe(true);
    expect(Value.Check(LevelInfoSchema, { level: 10, xpInLevel: 0 })).toBe(true);
    expect(Value.Check(LevelInfoSchema, { level: 0, xpInLevel: 0 })).toBe(false);
  });

  it('ProgressionSummarySchema accepts an optional level', () => {
    const base = {
      totalXp: 150,
      questsCompleted: 0,
      achievements: []
    };
    expect(Value.Check(ProgressionSummarySchema, base)).toBe(true);
    expect(
      Value.Check(ProgressionSummarySchema, {
        ...base,
        level: { level: 2, xpInLevel: 50, nextLevelAt: 250 }
      })
    ).toBe(true);
    expect(Value.Check(ProgressionSummarySchema, { ...base, totalXp: -1 })).toBe(false);
  });
});
