import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';

/**
 * Territory is an opt-in 6–8 week MMR season (ADR-0008). These read models are
 * schema-level only at the Foundation gate; territory remains disabled until
 * the Territory gate passes.
 */
export const TerritoryStatusSchema = Type.Union([
  Type.Literal('announced'),
  Type.Literal('open'),
  Type.Literal('live'),
  Type.Literal('ended')
]);

export const TerritorySeasonSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    status: TerritoryStatusSchema,
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    h3Resolution: Type.Integer({ minimum: 0, maximum: 15 }),
    scoringRuleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'TerritorySeason' }
);

export const TerritoryEnrollmentSchema = Type.Object(
  {
    seasonId: UuidSchema,
    accountId: UuidSchema,
    division: Type.String({ minLength: 1, maxLength: 64 }),
    enrolledAt: DateTimeSchema
  },
  { $id: 'TerritoryEnrollment' }
);

/**
 * Cells expose no route, timestamp, exact start/finish, or owner identity.
 * `cellIndex` is an H3 index stored as a string with pinned version metadata.
 */
export const CellContributionSchema = Type.Object(
  {
    id: UuidSchema,
    seasonId: UuidSchema,
    accountId: UuidSchema,
    cellIndex: Type.String({ minLength: 1, maxLength: 32 }),
    localDate: Type.String({ format: 'date' }),
    h3Version: Type.String({ minLength: 1, maxLength: 64 }),
    algorithmVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'CellContribution' }
);

export const CellControlSnapshotSchema = Type.Object(
  {
    seasonId: UuidSchema,
    weekStartsOn: Type.String({ format: 'date' }),
    version: Type.Integer({ minimum: 1 }),
    cellIndex: Type.String({ minLength: 1, maxLength: 32 }),
    /** Opaque participant reference; never a display identity on the map. */
    controllingParticipantRef: Type.Optional(Type.String({ maxLength: 64 })),
    createdAt: DateTimeSchema
  },
  { $id: 'CellControlSnapshot' }
);

export type TerritoryStatus = Static<typeof TerritoryStatusSchema>;
export type TerritorySeason = Static<typeof TerritorySeasonSchema>;
export type TerritoryEnrollment = Static<typeof TerritoryEnrollmentSchema>;
export type CellContribution = Static<typeof CellContributionSchema>;
export type CellControlSnapshot = Static<typeof CellControlSnapshotSchema>;

/**
 * The season as a member sees it (Phase 4, milestone 4.1).
 *
 * Everything a person needs in order to decide whether to take part, and
 * nothing about where anybody has been. `captureEnabled` is false and says so
 * out loud: a season currently records who is taking part and in which
 * division, and claims no cells at all.
 */
export const TerritorySeasonViewSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    status: TerritoryStatusSchema,
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    /** Whether this season can be joined right now. */
    joinable: Type.Boolean(),
    /** False until the Territory gate passes; the app says so where it matters. */
    captureEnabled: Type.Boolean(),
    /** How many people are taking part. A count, never a list. */
    participantCount: Type.Integer({ minimum: 0 }),
    /** The reader's own enrollment, absent when they have not joined. */
    enrollment: Type.Optional(
      Type.Object(
        {
          division: Type.String({ minLength: 1, maxLength: 64 }),
          /**
           * The band the division was read from, so an assignment can be
           * explained to the person it was made about rather than being a
           * label they cannot question.
           */
          priorActiveWeeks: Type.Integer({ minimum: 0 }),
          enrolledAt: DateTimeSchema
        },
        { $id: 'TerritoryEnrollmentView' }
      )
    ),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'TerritorySeasonView' }
);

/**
 * The answer when no season exists or none is joinable. A season is not a
 * permanent fixture of the product, and a screen that implied one was coming
 * would be inventing a commitment nobody made.
 */
export const TerritorySeasonResponseSchema = Type.Object(
  {
    season: Type.Optional(TerritorySeasonViewSchema),
    /** Said whether or not a season exists, because it is true either way. */
    captureNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritorySeasonResponse' }
);

export const TerritoryEnrollmentRequestSchema = Type.Object(
  { enrolled: Type.Boolean() },
  { ...Strict, $id: 'TerritoryEnrollmentRequest' }
);

/** Scheduling a season. Staff work: `season_operator` or `admin`. */
export const TerritorySeasonCreateRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    h3Resolution: Type.Integer({ minimum: 0, maximum: 15 }),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { ...Strict, $id: 'TerritorySeasonCreateRequest' }
);

export const TerritorySeasonStatusRequestSchema = Type.Object(
  { status: Type.Union([Type.Literal('open'), Type.Literal('ended')]) },
  { ...Strict, $id: 'TerritorySeasonStatusRequest' }
);

/** One division's enrolled size, for planning the next season. */
export const DivisionSizeSchema = Type.Object(
  {
    division: Type.String({ minLength: 1, maxLength: 64 }),
    enrolledCount: Type.Integer({ minimum: 0 }),
    /** Advice for the next season start, never an action taken now. */
    advice: Type.Union([Type.Literal('merge'), Type.Literal('split'), Type.Literal('healthy')])
  },
  { $id: 'DivisionSize' }
);

export const DivisionSizeListResponseSchema = Type.Object(
  { data: Type.Array(DivisionSizeSchema, { maxItems: 100 }) },
  { $id: 'DivisionSizeListResponse' }
);

export const TerritorySeasonParamsSchema = Type.Object(
  { seasonId: UuidSchema },
  { ...Strict, $id: 'TerritorySeasonParams' }
);

export type TerritorySeasonView = Static<typeof TerritorySeasonViewSchema>;
export type TerritorySeasonResponse = Static<typeof TerritorySeasonResponseSchema>;
export type TerritoryEnrollmentRequest = Static<typeof TerritoryEnrollmentRequestSchema>;
export type TerritorySeasonCreateRequest = Static<typeof TerritorySeasonCreateRequestSchema>;
export type TerritorySeasonStatusRequest = Static<typeof TerritorySeasonStatusRequestSchema>;
export type DivisionSize = Static<typeof DivisionSizeSchema>;
export type DivisionSizeListResponse = Static<typeof DivisionSizeListResponseSchema>;
export type TerritorySeasonParams = Static<typeof TerritorySeasonParamsSchema>;
