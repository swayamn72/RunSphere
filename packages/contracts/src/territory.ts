import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, UuidSchema } from './common.js';

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
