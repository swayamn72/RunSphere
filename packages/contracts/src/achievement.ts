import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema } from './common.js';

/**
 * A published achievement as shown to the account, with its earned state.
 * Achievements are cosmetic-only and versioned (ADR-0005); a rule change
 * supersedes the definition without rewriting award history.
 */
export const AchievementStatusSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 80 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 500 }),
    rewardXp: Type.Integer({ minimum: 0 }),
    earned: Type.Boolean(),
    awardedAt: Type.Optional(DateTimeSchema)
  },
  { $id: 'AchievementStatus' }
);

export const AchievementListResponseSchema = Type.Object(
  { data: Type.Array(AchievementStatusSchema, { maxItems: 100 }) },
  { $id: 'AchievementListResponse' }
);

/** Idempotent evaluation acknowledgement; carries newly awarded achievements. */
export const AchievementSyncResponseSchema = Type.Object(
  {
    status: Type.Literal('synced'),
    newlyAwarded: Type.Integer({ minimum: 0 })
  },
  { $id: 'AchievementSyncResponse' }
);

export type AchievementStatus = Static<typeof AchievementStatusSchema>;
export type AchievementListResponse = Static<typeof AchievementListResponseSchema>;
export type AchievementSyncResponse = Static<typeof AchievementSyncResponseSchema>;
