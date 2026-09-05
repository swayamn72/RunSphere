import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, Strict, UuidSchema } from './common.js';
import { ProfileSchema } from './social.js';

export const CompetitionStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('published'),
  Type.Literal('open'),
  Type.Literal('closed'),
  Type.Literal('finalized'),
  Type.Literal('cancelled')
]);

export const CompetitionDefinitionSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    status: CompetitionStatusSchema,
    opensAt: DateTimeSchema,
    closesAt: DateTimeSchema,
    rewards: Type.String({ maxLength: 500 }),
    disputePeriodHours: Type.Integer({ minimum: 0, maximum: 8759 })
  },
  { $id: 'CompetitionDefinition' }
);

export const CompetitionEnrollmentSchema = Type.Object(
  {
    competitionId: UuidSchema,
    accountId: UuidSchema,
    enrolledAt: DateTimeSchema
  },
  { $id: 'CompetitionEnrollment' }
);

export type CompetitionStatus = Static<typeof CompetitionStatusSchema>;
export type CompetitionDefinition = Static<typeof CompetitionDefinitionSchema>;
export type CompetitionEnrollment = Static<typeof CompetitionEnrollmentSchema>;

/**
 * A scheduled competition as any member may see it (milestone 3.6).
 *
 * Everything a participant needs before deciding to enter is here and is
 * published in advance: the mode, the window, the eligibility band, the
 * rewards, and how long results stay provisional (`gameplay.md`).
 * `participantCount` is a count — who else entered appears only in the
 * standings, and only to somebody who entered themselves.
 */
export const CompetitionSummarySchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    mode: Type.Union([Type.Literal('active_minutes'), Type.Literal('active_days')]),
    status: CompetitionStatusSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    /** Least earlier active weeks required to enter; 0 is open to everyone. */
    minPriorActiveWeeks: Type.Integer({ minimum: 0, maximum: 520 }),
    /** Cosmetic or status only in v1: never cash, goods, or paid advantage. */
    rewards: Type.String({ maxLength: 500 }),
    disputePeriodHours: Type.Integer({ minimum: 0, maximum: 8759 }),
    /** When results stop being provisional; absent until the window closes. */
    disputeEndsAt: Type.Optional(DateTimeSchema),
    participantCount: Type.Integer({ minimum: 0 }),
    /** Whether the reader is currently entered. Their own state. */
    enrolled: Type.Boolean(),
    /** Whether the reader's history clears the published eligibility band. */
    eligible: Type.Boolean(),
    ruleVersion: Type.Integer({ minimum: 1 }),
    createdAt: DateTimeSchema
  },
  { $id: 'CompetitionSummary' }
);

export const CompetitionListResponseSchema = Type.Object(
  { data: Type.Array(CompetitionSummarySchema, { maxItems: 50 }) },
  { $id: 'CompetitionListResponse' }
);

/**
 * Entering or leaving one competition. The consent is per event and
 * revocable: entering publishes your score for that window to the others in
 * it, and withdrawing stops you being counted or shown from that moment.
 */
export const CompetitionEnrollmentRequestSchema = Type.Object(
  { enrolled: Type.Boolean() },
  { ...Strict, $id: 'CompetitionEnrollmentRequest' }
);

/**
 * One standing in a competition — the same privacy-minimized projection every
 * other board entry uses: an approved display identity, one published
 * pace-neutral score, and a rank. Never location, route, activity timestamps,
 * pace, distance, or live state.
 */
export const CompetitionStandingSchema = Type.Object(
  {
    profile: ProfileSchema,
    rank: Type.Integer({ minimum: 1 }),
    score: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'CompetitionStanding' }
);

/**
 * The standings of one competition. `enrolled` gates `entries` exactly as
 * every other board's opt-in does, and `provisional` says out loud that the
 * dispute period is still running, so a result is never presented as final
 * before it is.
 */
export const CompetitionStandingsResponseSchema = Type.Object(
  {
    competition: CompetitionSummarySchema,
    /** True while the window is open and the scores can still move. */
    live: Type.Boolean(),
    /** True once results exist but the dispute period has not elapsed. */
    provisional: Type.Boolean(),
    entries: Type.Array(CompetitionStandingSchema, { maxItems: 500 })
  },
  { $id: 'CompetitionStandingsResponse' }
);

export const CompetitionParamsSchema = Type.Object(
  { competitionId: UuidSchema },
  { ...Strict, $id: 'CompetitionParams' }
);

/**
 * Scheduling one, which is staff work (`season_operator` or `admin`). It is
 * created as a draft: an announcement is a commitment, so publishing is a
 * second, deliberate act.
 */
export const CompetitionCreateRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    mode: Type.Union([Type.Literal('active_minutes'), Type.Literal('active_days')]),
    periodStart: DateSchema,
    lengthDays: Type.Integer({ minimum: 1, maximum: 90 }),
    minPriorActiveWeeks: Type.Optional(Type.Integer({ minimum: 0, maximum: 520 })),
    rewards: Type.Optional(Type.String({ maxLength: 500 })),
    disputePeriodHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 8759 }))
  },
  { ...Strict, $id: 'CompetitionCreateRequest' }
);

export type CompetitionSummary = Static<typeof CompetitionSummarySchema>;
export type CompetitionListResponse = Static<typeof CompetitionListResponseSchema>;
export type CompetitionEnrollmentRequest = Static<typeof CompetitionEnrollmentRequestSchema>;
export type CompetitionStanding = Static<typeof CompetitionStandingSchema>;
export type CompetitionStandingsResponse = Static<typeof CompetitionStandingsResponseSchema>;
export type CompetitionParams = Static<typeof CompetitionParamsSchema>;
export type CompetitionCreateRequest = Static<typeof CompetitionCreateRequestSchema>;
