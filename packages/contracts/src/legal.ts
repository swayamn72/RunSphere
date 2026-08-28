import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, UuidSchema } from './common.js';

export const LegalDocumentKindSchema = Type.Union([
  Type.Literal('terms'),
  Type.Literal('privacy'),
  Type.Literal('community'),
  Type.Literal('competition_rules')
]);

export const LegalVersionSchema = Type.Object(
  {
    id: UuidSchema,
    kind: LegalDocumentKindSchema,
    version: Type.Integer({ minimum: 1 }),
    effectiveAt: DateTimeSchema,
    url: Type.String({ maxLength: 500 })
  },
  { $id: 'LegalVersion' }
);

/** Consent records reference the exact legal version presented; they are append-only. */
export const ConsentRecordSchema = Type.Object(
  {
    id: UuidSchema,
    accountId: UuidSchema,
    kind: LegalDocumentKindSchema,
    version: Type.Integer({ minimum: 1 }),
    grantedAt: DateTimeSchema
  },
  { $id: 'ConsentRecord' }
);

export type LegalDocumentKind = Static<typeof LegalDocumentKindSchema>;
export type LegalVersion = Static<typeof LegalVersionSchema>;
export type ConsentRecord = Static<typeof ConsentRecordSchema>;
