import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, UuidSchema } from './common.js';

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
