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

/**
 * Scheduling and sending campaigns (milestone 3.9).
 *
 * A campaign references a reviewed template rather than carrying a body, so
 * what goes out is something a human approved. Everything a campaign manager
 * sees about an audience is a *count*: this file has no shape that can carry a
 * list of the people a campaign would reach, or an email address at all.
 */
export const CampaignSummarySchema = Type.Object(
  {
    id: UuidSchema,
    templateKey: Type.String({ minLength: 1, maxLength: 80 }),
    /** Resolved when the campaign is scheduled; absent while it is a draft. */
    templateVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    audience: CampaignAudienceSchema,
    status: CampaignStatusSchema,
    sendCap: Type.Integer({ minimum: 1 }),
    scheduledFor: Type.Optional(DateTimeSchema),
    /** How many accounts it has actually reached, and how many it did not. */
    queuedCount: Type.Integer({ minimum: 0 }),
    sentCount: Type.Integer({ minimum: 0 }),
    skippedCount: Type.Integer({ minimum: 0 }),
    createdAt: DateTimeSchema
  },
  { $id: 'CampaignSummary' }
);

export const CampaignListResponseSchema = Type.Object(
  { data: Type.Array(CampaignSummarySchema, { maxItems: 100 }) },
  { $id: 'CampaignListResponse' }
);

export const CampaignCreateRequestSchema = Type.Object(
  {
    templateKey: Type.String({ minLength: 1, maxLength: 80 }),
    audience: CampaignAudienceSchema,
    sendCap: Type.Integer({ minimum: 1, maximum: 100000 })
  },
  { ...Strict, $id: 'CampaignCreateRequest' }
);

export const CampaignScheduleRequestSchema = Type.Object(
  { scheduledFor: DateTimeSchema },
  { ...Strict, $id: 'CampaignScheduleRequest' }
);

/**
 * What a campaign would reach, before it is scheduled: a count and nothing
 * else. A preview that listed accounts would turn the campaign tool into an
 * export of who consented to marketing, which is not what a campaign manager
 * needs in order to decide whether an audience is sane.
 */
export const CampaignPreviewResponseSchema = Type.Object(
  {
    /** Accounts matching the audience right now, before the cap is applied. */
    matchingCount: Type.Integer({ minimum: 0 }),
    /** What the cap would reduce that to. */
    cappedCount: Type.Integer({ minimum: 0 }),
    sendCap: Type.Integer({ minimum: 1 })
  },
  { $id: 'CampaignPreviewResponse' }
);

/**
 * Unsubscribing from an email link. The token is a bearer credential for this
 * one narrow act, so it is not a session and grants nothing else; the answer
 * is the same whether or not it matched, so the endpoint cannot be used to
 * test tokens.
 */
export const UnsubscribeRequestSchema = Type.Object(
  { token: Type.String({ minLength: 16, maxLength: 128 }) },
  { ...Strict, $id: 'UnsubscribeRequest' }
);

export const UnsubscribeResponseSchema = Type.Object(
  { message: Type.String({ minLength: 1, maxLength: 300 }) },
  { $id: 'UnsubscribeResponse' }
);

export const CampaignParamsSchema = Type.Object(
  { campaignId: UuidSchema },
  { ...Strict, $id: 'CampaignParams' }
);

export type CampaignSummary = Static<typeof CampaignSummarySchema>;
export type CampaignListResponse = Static<typeof CampaignListResponseSchema>;
export type CampaignCreateRequest = Static<typeof CampaignCreateRequestSchema>;
export type CampaignScheduleRequest = Static<typeof CampaignScheduleRequestSchema>;
export type CampaignPreviewResponse = Static<typeof CampaignPreviewResponseSchema>;
export type UnsubscribeRequest = Static<typeof UnsubscribeRequestSchema>;
export type UnsubscribeResponse = Static<typeof UnsubscribeResponseSchema>;
export type CampaignParams = Static<typeof CampaignParamsSchema>;

/**
 * A reviewed email template (milestone 3.10). A campaign references a key and
 * a version rather than carrying a body, so publishing a new version is the
 * act of approving new copy — and a version already used by a campaign is
 * never edited, only superseded.
 */
export const EmailTemplateSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 80 }),
    version: Type.Integer({ minimum: 1 }),
    subject: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.String({ minLength: 1, maxLength: 20000 }),
    live: Type.Boolean(),
    createdAt: DateTimeSchema
  },
  { $id: 'EmailTemplate' }
);

export const EmailTemplateListResponseSchema = Type.Object(
  { data: Type.Array(EmailTemplateSchema, { maxItems: 200 }) },
  { $id: 'EmailTemplateListResponse' }
);

export const EmailTemplateCreateRequestSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 80 }),
    subject: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.String({ minLength: 1, maxLength: 20000 })
  },
  { ...Strict, $id: 'EmailTemplateCreateRequest' }
);

export type EmailTemplate = Static<typeof EmailTemplateSchema>;
export type EmailTemplateListResponse = Static<typeof EmailTemplateListResponseSchema>;
export type EmailTemplateCreateRequest = Static<typeof EmailTemplateCreateRequestSchema>;
