import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, Strict, UuidSchema } from './common.js';
import { ProfileSchema } from './social.js';

export const ChallengeModeSchema = Type.Union([
  Type.Literal('active_minutes'),
  Type.Literal('active_days'),
  Type.Literal('quest_completion')
]);

/** Asynchronous 1v1 challenges run over a 3- or 7-day window. */
export const ChallengeLengthDaysSchema = Type.Union([Type.Literal(3), Type.Literal(7)]);

/**
 * Which side of the challenge the reading account is on. Only the `opponent`
 * of an `invited` challenge may accept or decline it, so a client cannot tell
 * an invite it must answer from one it sent without this.
 */
export const ChallengeRoleSchema = Type.Union([
  Type.Literal('challenger'),
  Type.Literal('opponent')
]);

export const ChallengeStatusSchema = Type.Union([
  Type.Literal('invited'),
  Type.Literal('accepted'),
  Type.Literal('declined'),
  Type.Literal('active'),
  Type.Literal('finished'),
  Type.Literal('cancelled')
]);

export const ChallengeCreateRequestSchema = Type.Object(
  {
    friendAccountId: UuidSchema,
    mode: ChallengeModeSchema,
    lengthDays: ChallengeLengthDaysSchema
  },
  { ...Strict, $id: 'ChallengeCreateRequest' }
);

export const ChallengeSummarySchema = Type.Object(
  {
    id: UuidSchema,
    mode: ChallengeModeSchema,
    lengthDays: ChallengeLengthDaysSchema,
    status: ChallengeStatusSchema,
    role: ChallengeRoleSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    opponent: ProfileSchema,
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    createdAt: DateTimeSchema
  },
  { $id: 'ChallengeSummary' }
);

export const ChallengeListResponseSchema = Type.Object(
  { data: Type.Array(ChallengeSummarySchema, { maxItems: 200 }) },
  { $id: 'ChallengeListResponse' }
);

export const ChallengeRespondRequestSchema = Type.Object(
  { accept: Type.Boolean() },
  { ...Strict, $id: 'ChallengeRespondRequest' }
);

export const ChallengeResultSchema = Type.Object(
  {
    id: UuidSchema,
    mode: ChallengeModeSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    /** Privacy-minimized pace-neutral totals; never pace, distance, or route. */
    participants: Type.Array(
      Type.Object(
        {
          accountId: UuidSchema,
          score: Type.Integer({ minimum: 0 })
        },
        Strict
      ),
      { minItems: 2, maxItems: 2 }
    ),
    winnerAccountId: Type.Optional(UuidSchema),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'ChallengeResult' }
);

export const ChallengeParamsSchema = Type.Object(
  { challengeId: UuidSchema },
  { ...Strict, $id: 'ChallengeParams' }
);

export type ChallengeParams = Static<typeof ChallengeParamsSchema>;
export type ChallengeMode = Static<typeof ChallengeModeSchema>;
export type ChallengeLengthDays = Static<typeof ChallengeLengthDaysSchema>;
export type ChallengeStatus = Static<typeof ChallengeStatusSchema>;
export type ChallengeRole = Static<typeof ChallengeRoleSchema>;
export type ChallengeCreateRequest = Static<typeof ChallengeCreateRequestSchema>;
export type ChallengeSummary = Static<typeof ChallengeSummarySchema>;
export type ChallengeListResponse = Static<typeof ChallengeListResponseSchema>;
export type ChallengeRespondRequest = Static<typeof ChallengeRespondRequestSchema>;
export type ChallengeResult = Static<typeof ChallengeResultSchema>;
