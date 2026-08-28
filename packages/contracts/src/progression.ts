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
    weeklyConsistency: Type.Optional(WeeklyConsistencySchema)
  },
  { $id: 'ProgressionSummary' }
);

export type XpSource = Static<typeof XpSourceSchema>;
export type XpLedgerEntry = Static<typeof XpLedgerEntrySchema>;
export type AchievementAward = Static<typeof AchievementAwardSchema>;
export type WeeklyConsistency = Static<typeof WeeklyConsistencySchema>;
export type ProgressionSummary = Static<typeof ProgressionSummarySchema>;
