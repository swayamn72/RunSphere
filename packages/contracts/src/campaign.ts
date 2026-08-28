import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';

export const CampaignStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('scheduled'),
  Type.Literal('sending'),
  Type.Literal('paused'),
  Type.Literal('sent'),
  Type.Literal('cancelled')
]);

/**
 * Campaign audiences may use consent, locale, app version, feature cohort, and
 * broad recency bands only — never raw/coarse location history, pace, health
 * inference, exact quest history, or unreviewed free-form SQL.
 */
export const CampaignAudienceSchema = Type.Object(
  {
    consentRequired: Type.Boolean(),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
    appVersions: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 20 })),
    featureCohorts: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 20 })),
    recencyBandDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 }))
  },
  Strict
);

export const CampaignDraftSchema = Type.Object(
  {
    id: UuidSchema,
    templateKey: Type.String({ minLength: 1, maxLength: 80 }),
    audience: CampaignAudienceSchema,
    status: CampaignStatusSchema,
    sendCap: Type.Integer({ minimum: 1 }),
    scheduledFor: Type.Optional(DateTimeSchema),
    createdAt: DateTimeSchema
  },
  { $id: 'CampaignDraft' }
);

export type CampaignStatus = Static<typeof CampaignStatusSchema>;
export type CampaignAudience = Static<typeof CampaignAudienceSchema>;
export type CampaignDraft = Static<typeof CampaignDraftSchema>;
