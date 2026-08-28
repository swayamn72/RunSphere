import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, EmailSchema, Strict, UuidSchema } from './common.js';

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

export const FriendNotFoundResponseSchema = Type.Object(
  { message: Type.Literal('Friend not found') },
  { $id: 'FriendNotFoundResponse' }
);

export type Profile = Static<typeof ProfileSchema>;
export type ProfileUpdateRequest = Static<typeof ProfileUpdateRequestSchema>;
export type FriendRequest = Static<typeof FriendRequestSchema>;
export type FriendRequestCreateRequest = Static<typeof FriendRequestCreateRequestSchema>;
export type FriendRequestRespondRequest = Static<typeof FriendRequestRespondRequestSchema>;
export type FriendListResponse = Static<typeof FriendListResponseSchema>;
export type BlockCreateRequest = Static<typeof BlockCreateRequestSchema>;
export type BlockResponse = Static<typeof BlockResponseSchema>;
