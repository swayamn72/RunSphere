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

/**
 * Whether the signed-in runner has agreed to the legal text now in force
 * (M9 9.26). Sign-up records the version shown then; when the text changes the
 * app asks again before the runner carries on.
 */
export const LegalConsentStatusSchema = Type.Object(
  {
    currentVersion: Type.String({ maxLength: 64 }),
    acceptedVersion: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    needsAcceptance: Type.Boolean()
  },
  { additionalProperties: false, $id: 'LegalConsentStatus' }
);
export const LegalConsentRequestSchema = Type.Object(
  { policyVersion: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false, $id: 'LegalConsentRequest' }
);
export type LegalConsentStatus = Static<typeof LegalConsentStatusSchema>;
