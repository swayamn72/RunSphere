import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, EmailSchema, Strict, UuidSchema } from './common.js';

const DisplayNameSchema = Type.String({ minLength: 1, maxLength: 40 });
const VisibilitySchema = Type.Union([Type.Literal('private'), Type.Literal('followers')]);
const CosmeticSchema = Type.Object(
  {
    avatarKey: Type.String({ minLength: 1, maxLength: 64 }),
    tier: Type.Optional(Type.String({ minLength: 1, maxLength: 32 }))
  },
  Strict
);

/**
 * The only identity a gameplay or social surface may reveal about an account.
 * No email, coarse location, or activity detail is included.
 */
export const ProfileSchema = Type.Object(
  {
    id: UuidSchema,
    displayName: DisplayNameSchema,
    cosmetic: CosmeticSchema,
    activityVisibility: VisibilitySchema
  },
  { $id: 'Profile' }
);

export const ProfileUpdateRequestSchema = Type.Object(
  {
    displayName: Type.Optional(DisplayNameSchema),
    cosmetic: Type.Optional(CosmeticSchema)
  },
  { ...Strict, $id: 'ProfileUpdateRequest' }
);

export const ProfileResponseSchema = ProfileSchema;

export const FriendRequestStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('declined'),
  Type.Literal('revoked'),
  Type.Literal('blocked')
]);

export const FriendRequestSchema = Type.Object(
  {
    id: UuidSchema,
    /** The account that owns this profile view (never the counterparty's email). */
    accountId: UuidSchema,
    counterpartProfile: ProfileSchema,
    status: FriendRequestStatusSchema,
    createdAt: DateTimeSchema,
    respondedAt: Type.Optional(DateTimeSchema)
  },
  { $id: 'FriendRequest' }
);

/** Requests by exact email. The response is deliberately generic to prevent address enumeration. */
export const FriendRequestCreateRequestSchema = Type.Object(
  { email: EmailSchema },
  { ...Strict, $id: 'FriendRequestCreateRequest' }
);

export const FriendRequestCreateResponseSchema = Type.Object(
  { status: Type.Literal('recorded') },
  { $id: 'FriendRequestCreateResponse' }
);

export const FriendRequestRespondRequestSchema = Type.Object(
  { accept: Type.Boolean() },
  { ...Strict, $id: 'FriendRequestRespondRequest' }
);

export const FriendListResponseSchema = Type.Object(
  { data: Type.Array(ProfileSchema, { maxItems: 500 }) },
  { $id: 'FriendListResponse' }
);

/**
 * One friend-board entry (ADR-0007). A board entry carries an approved display
 * identity, one published pace-neutral score, and a rank — never location,
 * route, activity timestamps, pace, distance, or live state.
 */
export const FriendStandingEntrySchema = Type.Object(
  {
    profile: ProfileSchema,
    /** Competition rank: equal scores share a rank and the next rank skips. */
    rank: Type.Integer({ minimum: 1 }),
    /** The single published score: whole validated active minutes, per-day capped. */
    cappedActiveMinutes: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'FriendStandingEntry' }
);

/**
 * The friend board is opt-in and revocable, independently of activity
 * visibility (ADR-0007). `entries` is empty while `participating` is false: an
 * account that is not on the board does not read other people's scores.
 */
export const FriendStandingsResponseSchema = Type.Object(
  {
    periodStart: DateSchema,
    periodEnd: DateSchema,
    participating: Type.Boolean(),
    ruleVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    entries: Type.Array(FriendStandingEntrySchema, { maxItems: 200 })
  },
  { $id: 'FriendStandingsResponse' }
);

export const FriendStandingsParticipationRequestSchema = Type.Object(
  { participating: Type.Boolean() },
  { ...Strict, $id: 'FriendStandingsParticipationRequest' }
);

export const BlockCreateRequestSchema = Type.Object(
  {
    accountId: Type.String({ format: 'uuid' }),
    reason: Type.Optional(Type.String({ maxLength: 200 }))
  },
  { ...Strict, $id: 'BlockCreateRequest' }
);

export const BlockResponseSchema = Type.Object(
  {
    accountId: UuidSchema,
    status: Type.Union([Type.Literal('blocked'), Type.Literal('unblocked')])
  },
  { $id: 'BlockResponse' }
);

/**
 * One live block, as the blocker may see it. A blocked account is removed from
 * every friend and board surface, so this list is the only place it can be
 * found again -- without it a block would be irreversible from the client.
 * The stored reason is deliberately not returned: it is moderation context,
 * not something to re-present to the person who wrote it.
 */
export const BlockedAccountSchema = Type.Object(
  {
    profile: ProfileSchema,
    blockedAt: DateTimeSchema
  },
  { $id: 'BlockedAccount' }
);

export const BlockListResponseSchema = Type.Object(
  { data: Type.Array(BlockedAccountSchema, { maxItems: 500 }) },
  { $id: 'BlockListResponse' }
);

export const FriendRequestParamsSchema = Type.Object(
  { requestId: UuidSchema },
  { ...Strict, $id: 'FriendRequestParams' }
);

export const FriendRequestListResponseSchema = Type.Object(
  { data: Type.Array(FriendRequestSchema, { maxItems: 200 }) },
  { $id: 'FriendRequestListResponse' }
);

export const BlockParamsSchema = Type.Object(
  { accountId: UuidSchema },
  { ...Strict, $id: 'BlockParams' }
);

export const FriendNotFoundResponseSchema = Type.Object(
  { message: Type.Literal('Friend not found') },
  { $id: 'FriendNotFoundResponse' }
);

export type Profile = Static<typeof ProfileSchema>;
export type ProfileUpdateRequest = Static<typeof ProfileUpdateRequestSchema>;
export type FriendRequest = Static<typeof FriendRequestSchema>;
export type FriendRequestStatus = Static<typeof FriendRequestStatusSchema>;
export type FriendRequestCreateRequest = Static<typeof FriendRequestCreateRequestSchema>;
export type FriendRequestCreateResponse = Static<typeof FriendRequestCreateResponseSchema>;
export type FriendRequestRespondRequest = Static<typeof FriendRequestRespondRequestSchema>;
export type FriendListResponse = Static<typeof FriendListResponseSchema>;
export type BlockCreateRequest = Static<typeof BlockCreateRequestSchema>;
export type BlockResponse = Static<typeof BlockResponseSchema>;
export type FriendRequestParams = Static<typeof FriendRequestParamsSchema>;
export type FriendRequestListResponse = Static<typeof FriendRequestListResponseSchema>;
export type BlockParams = Static<typeof BlockParamsSchema>;
export type BlockedAccount = Static<typeof BlockedAccountSchema>;
export type BlockListResponse = Static<typeof BlockListResponseSchema>;
export type FriendStandingEntry = Static<typeof FriendStandingEntrySchema>;
export type FriendStandingsResponse = Static<typeof FriendStandingsResponseSchema>;
export type FriendStandingsParticipationRequest = Static<
  typeof FriendStandingsParticipationRequestSchema
>;
