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
    channels: Type.Object({ push: Type.Boolean(), email: Type.Boolean() }, Strict),
    /**
     * Consent to campaign email, off by default and separate from the
     * `marketing` category and the `email` channel. A campaign requires all
     * three (milestone 3.9), so no single forgotten switch can put mail in
     * somebody's inbox — and turning this off is an unsubscribe wherever it is
     * done.
     */
    marketingConsent: Type.Boolean()
  },
  { $id: 'NotificationPreferences' }
);

/**
 * A partial update: an absent key leaves that preference unchanged.
 *
 * `quietHours` is spelled out rather than derived from `Type.Partial`, because
 * partial-of-optional cannot express *clearing* the window: `undefined` is
 * dropped by JSON serialisation and would read as "unchanged", so quiet hours
 * could be set and never switched off. An explicit `null` is the clear signal.
 */
export const NotificationPreferencesUpdateRequestSchema = Type.Object(
  {
    categories: Type.Optional(Type.Record(NotificationCategorySchema, Type.Boolean())),
    quietHours: Type.Optional(Type.Union([QuietHoursSchema, Type.Null()])),
    maxPerDay: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    channels: Type.Optional(Type.Object({ push: Type.Boolean(), email: Type.Boolean() }, Strict)),
    marketingConsent: Type.Optional(Type.Boolean())
  },
  { ...Strict, $id: 'NotificationPreferencesUpdateRequest' }
);

export type NotificationKind = Static<typeof NotificationKindSchema>;
export type NotificationCategory = Static<typeof NotificationCategorySchema>;
export type InboxEntry = Static<typeof InboxEntrySchema>;
export type InboxListResponse = Static<typeof InboxListResponseSchema>;
export type InboxMarkReadRequest = Static<typeof InboxMarkReadRequestSchema>;
export type NotificationPreferences = Static<typeof NotificationPreferencesSchema>;
export type NotificationPreferencesUpdateRequest = Static<
  typeof NotificationPreferencesUpdateRequestSchema
>;

/**
 * Push registration (ADR-0009). Android only: iOS parity is Phase 5, and
 * accepting an iOS token before an iOS client exists would store a
 * registration nothing can ever deliver to.
 */
export const PushPlatformSchema = Type.Union([Type.Literal('android')]);

export const PushDeviceRegisterRequestSchema = Type.Object(
  {
    /** Opaque provider registration token. Never returned by any read route. */
    token: Type.String({ minLength: 1, maxLength: 4096 }),
    platform: PushPlatformSchema
  },
  { ...Strict, $id: 'PushDeviceRegisterRequest' }
);

/**
 * A registration as the owning account may see it. The token is deliberately
 * absent: the client already holds it, and echoing it back would put a device
 * credential in a response body and in every client log that captures one.
 */
export const PushDeviceSchema = Type.Object(
  {
    id: UuidSchema,
    platform: PushPlatformSchema,
    createdAt: DateTimeSchema,
    lastSeenAt: DateTimeSchema
  },
  { $id: 'PushDevice' }
);

export const PushDeviceParamsSchema = Type.Object(
  { deviceId: UuidSchema },
  { ...Strict, $id: 'PushDeviceParams' }
);

export type PushPlatform = Static<typeof PushPlatformSchema>;
export type PushDeviceRegisterRequest = Static<typeof PushDeviceRegisterRequestSchema>;
export type PushDevice = Static<typeof PushDeviceSchema>;
export type PushDeviceParams = Static<typeof PushDeviceParamsSchema>;
