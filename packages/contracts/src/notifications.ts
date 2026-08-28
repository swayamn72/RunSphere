import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';

export const NotificationKindSchema = Type.Union([
  Type.Literal('friend_request'),
  Type.Literal('challenge_invite'),
  Type.Literal('challenge_finished'),
  Type.Literal('club_invite'),
  Type.Literal('competition'),
  Type.Literal('account'),
  Type.Literal('system')
]);

/**
 * Durable inbox entry of record. `deepLink` is an opaque, safe deep link; it
 * never includes location or sensitive scores.
 */
export const InboxEntrySchema = Type.Object(
  {
    id: UuidSchema,
    kind: NotificationKindSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    body: Type.String({ maxLength: 500 }),
    deepLink: Type.Optional(Type.String({ maxLength: 500 })),
    readAt: Type.Optional(DateTimeSchema),
    createdAt: DateTimeSchema
  },
  { $id: 'InboxEntry' }
);

export const InboxListResponseSchema = Type.Object(
  { data: Type.Array(InboxEntrySchema, { maxItems: 200 }) },
  { $id: 'InboxListResponse' }
);

export const InboxMarkReadRequestSchema = Type.Object(
  { ids: Type.Array(UuidSchema, { minItems: 1, maxItems: 200 }) },
  { ...Strict, $id: 'InboxMarkReadRequest' }
);

export const NotificationCategorySchema = Type.Union([
  Type.Literal('friends'),
  Type.Literal('challenges'),
  Type.Literal('clubs'),
  Type.Literal('competitions'),
  Type.Literal('account'),
  Type.Literal('marketing')
]);

export const QuietHoursSchema = Type.Object(
  {
    start: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
    end: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
    timezone: Type.String({ minLength: 1, maxLength: 64 })
  },
  Strict
);

export const NotificationPreferencesSchema = Type.Object(
  {
    categories: Type.Record(NotificationCategorySchema, Type.Boolean()),
    quietHours: Type.Optional(QuietHoursSchema),
    maxPerDay: Type.Integer({ minimum: 1, maximum: 200 }),
    channels: Type.Object({ push: Type.Boolean(), email: Type.Boolean() }, Strict)
  },
  { $id: 'NotificationPreferences' }
);

export const NotificationPreferencesUpdateRequestSchema = Type.Partial(
  NotificationPreferencesSchema,
  { ...Strict, $id: 'NotificationPreferencesUpdateRequest' }
);

export type NotificationKind = Static<typeof NotificationKindSchema>;
export type InboxEntry = Static<typeof InboxEntrySchema>;
export type InboxListResponse = Static<typeof InboxListResponseSchema>;
export type InboxMarkReadRequest = Static<typeof InboxMarkReadRequestSchema>;
export type NotificationPreferences = Static<typeof NotificationPreferencesSchema>;
export type NotificationPreferencesUpdateRequest = Static<
  typeof NotificationPreferencesUpdateRequestSchema
>;
