import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, UuidSchema } from './common.js';

/**
 * Progression is cosmetic only (ADR-0005). XP never affects eligibility,
 * matchmaking, or territory value.
 */
export const XpSourceSchema = Type.Union([
  Type.Literal('active_minutes'),
  Type.Literal('quest_completion'),
  Type.Literal('active_day_consistency'),
  Type.Literal('achievement')
]);

export const XpLedgerEntrySchema = Type.Object(
  {
    id: UuidSchema,
    source: XpSourceSchema,
    amount: Type.Integer({ minimum: 1 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    periodStart: DateSchema,
    activityId: Type.Optional(UuidSchema),
    createdAt: DateTimeSchema
  },
  { $id: 'XpLedgerEntry' }
);

export const AchievementDefinitionSchema = Type.Object(
  {
    id: UuidSchema,
    key: Type.String({ minLength: 1, maxLength: 80 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 500 }),
    publishedAt: Type.Optional(DateTimeSchema)
  },
  { $id: 'AchievementDefinition' }
);

export const AchievementAwardSchema = Type.Object(
  {
    id: UuidSchema,
    achievementKey: Type.String({ minLength: 1, maxLength: 80 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    awardedAt: DateTimeSchema
  },
  { $id: 'AchievementAward' }
);

/**
 * Cosmetic level derived from the cumulative XP thresholds published in a
 * progression rule. `nextLevelAt` is omitted at the terminal level.
 */
export const LevelInfoSchema = Type.Object(
  {
    level: Type.Integer({ minimum: 1 }),
    xpInLevel: Type.Integer({ minimum: 0 }),
    nextLevelAt: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { $id: 'LevelInfo' }
);

/**
 * Published progression rule (rule_versions.kind = 'progression'). XP never
 * affects eligibility, matchmaking, or territory value (ADR-0005); this is a
 * pure cosmetics configuration consumed by `@runsphere/domain`.
 */
export const ProgressionRuleSchema = Type.Object(
  {
    xpPerActiveMinute: Type.Integer({ minimum: 0 }),
    xpPerActiveDay: Type.Integer({ minimum: 0 }),
    dailyCapMinutes: Type.Integer({ minimum: 1 }),
    minMinutesPerActiveDay: Type.Integer({ minimum: 1 }),
    goalActiveDays: Type.Integer({ minimum: 1, maximum: 7 }),
    levels: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 })
  },
  { $id: 'ProgressionRule' }
);

/**
 * Optional weekly consistency card. Resets without loss; never frames missed
 * days as destructive to lifetime progress (ADR-0005).
 */
export const WeeklyConsistencySchema = Type.Object(
  {
    periodStart: DateSchema,
    activeDays: Type.Integer({ minimum: 0, maximum: 7 }),
    cappedActiveMinutes: Type.Integer({ minimum: 0 }),
    goalActiveDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
    current: Type.Boolean()
  },
  { $id: 'WeeklyConsistency' }
);

export const ProgressionSummarySchema = Type.Object(
  {
    totalXp: Type.Integer({ minimum: 0 }),
    questsCompleted: Type.Integer({ minimum: 0 }),
    achievements: Type.Array(AchievementAwardSchema, { maxItems: 500 }),
    weeklyConsistency: Type.Optional(WeeklyConsistencySchema),
    level: Type.Optional(LevelInfoSchema)
  },
  { $id: 'ProgressionSummary' }
);

/** Idempotent sync acknowledgement; carries the number of closed weeks finalized. */
export const ProgressionSyncResponseSchema = Type.Object(
  {
    status: Type.Literal('synced'),
    finalizedWeeks: Type.Integer({ minimum: 0 })
  },
  { $id: 'ProgressionSyncResponse' }
);

export type XpSource = Static<typeof XpSourceSchema>;
export type XpLedgerEntry = Static<typeof XpLedgerEntrySchema>;
export type AchievementAward = Static<typeof AchievementAwardSchema>;
export type WeeklyConsistency = Static<typeof WeeklyConsistencySchema>;
export type ProgressionSummary = Static<typeof ProgressionSummarySchema>;
export type LevelInfo = Static<typeof LevelInfoSchema>;
export type ProgressionRule = Static<typeof ProgressionRuleSchema>;
export type ProgressionSyncResponse = Static<typeof ProgressionSyncResponseSchema>;
