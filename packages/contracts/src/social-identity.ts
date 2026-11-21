import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, Strict, UuidSchema } from './common.js';

/** ADR-0014. The server checks the format again with `usernameProblem`. */
export const UsernameSchema = Type.String({ minLength: 3, maxLength: 21 });

export const ProfileVisibilitySchema = Type.Union([
  Type.Literal('everyone'),
  Type.Literal('friends'),
  Type.Literal('only_me')
]);
export const FriendRequestsFromSchema = Type.Union([
  Type.Literal('everyone'),
  Type.Literal('friends_of_friends'),
  Type.Literal('nobody')
]);

/** The fifteen controls minus those that live on their own screens (zones, notifications, safety). */
export const PrivacySettingsSchema = Type.Object(
  {
    profileVisibility: ProfileVisibilitySchema,
    searchable: Type.Boolean(),
    friendRequestsFrom: FriendRequestsFromSchema,
    runsVisibility: ProfileVisibilitySchema,
    showRouteMaps: Type.Boolean(),
    showStartTimes: Type.Boolean(),
    /** Others see routes without the first and last 200 m (9.0; applied by the run log). */
    trimStartFinish: Type.Boolean(),
    nameOnGround: Type.Boolean(),
    drawGround: Type.Boolean(),
    friendBoard: Type.Boolean(),
    ghostRaces: Type.Boolean(),
    /** False until the runner has seen and saved the screen once. */
    reviewed: Type.Boolean()
  },
  { $id: 'PrivacySettings' }
);

export const PrivacySettingsUpdateSchema = Type.Partial(
  Type.Object({
    profileVisibility: ProfileVisibilitySchema,
    searchable: Type.Boolean(),
    friendRequestsFrom: FriendRequestsFromSchema,
    runsVisibility: ProfileVisibilitySchema,
    showRouteMaps: Type.Boolean(),
    showStartTimes: Type.Boolean(),
    trimStartFinish: Type.Boolean(),
    nameOnGround: Type.Boolean(),
    drawGround: Type.Boolean(),
    friendBoard: Type.Boolean(),
    ghostRaces: Type.Boolean()
  }),
  { ...Strict, $id: 'PrivacySettingsUpdate' }
);

/** Username and home area, changed together on the identity screen. */
export const IdentityUpdateSchema = Type.Object(
  {
    username: Type.Optional(UsernameSchema),
    /** A name from the home-area list, or null to clear it. */
    homeArea: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 60 }), Type.Null()]))
  },
  { ...Strict, $id: 'IdentityUpdate' }
);

export const IdentityResponseSchema = Type.Object(
  {
    username: Type.String(),
    homeArea: Type.Optional(Type.String()),
    /** Never the date itself: whether one is on file, so the app can ask once. */
    hasDateOfBirth: Type.Boolean()
  },
  { $id: 'IdentityResponse' }
);

export const UsernameAvailabilitySchema = Type.Object(
  {
    username: Type.String(),
    available: Type.Boolean(),
    /** Why not, in the app's words, when `available` is false. */
    reason: Type.Optional(Type.String())
  },
  { $id: 'UsernameAvailability' }
);

export const UsernameParamsSchema = Type.Object(
  { username: Type.String({ minLength: 1, maxLength: 40 }) },
  { ...Strict, $id: 'UsernameParams' }
);

export const ProfileSearchQuerySchema = Type.Object(
  { q: Type.String({ minLength: 1, maxLength: 40 }) },
  { ...Strict, $id: 'ProfileSearchQuery' }
);

/** What a stranger, friend or search result may know about a runner. */
export const PublicProfileSchema = Type.Object(
  {
    id: UuidSchema,
    username: Type.String(),
    displayName: Type.String(),
    cosmetic: Type.Object({
      avatarKey: Type.String(),
      tier: Type.Optional(Type.String())
    }),
    homeArea: Type.Optional(Type.String()),
    relationship: Type.Union([
      Type.Literal('self'),
      Type.Literal('friend'),
      Type.Literal('request_sent'),
      Type.Literal('request_received'),
      Type.Literal('none')
    ]),
    /** Whether the reader may send a friend request now, per the runner's setting. */
    canSendRequest: Type.Boolean()
  },
  { $id: 'PublicProfile' }
);

export const ProfileSearchResponseSchema = Type.Object(
  { data: Type.Array(PublicProfileSchema, { maxItems: 20 }) },
  { $id: 'ProfileSearchResponse' }
);

/** Sign-up's new fields (ADR-0014); optional so older clients keep working. */
export const DateOfBirthSchema = DateSchema;

export type ProfileVisibility = Static<typeof ProfileVisibilitySchema>;
export type FriendRequestsFrom = Static<typeof FriendRequestsFromSchema>;
export type PrivacySettings = Static<typeof PrivacySettingsSchema>;
export type PrivacySettingsUpdate = Static<typeof PrivacySettingsUpdateSchema>;
export type IdentityUpdate = Static<typeof IdentityUpdateSchema>;
export type IdentityResponse = Static<typeof IdentityResponseSchema>;
export type UsernameAvailability = Static<typeof UsernameAvailabilitySchema>;
export type PublicProfile = Static<typeof PublicProfileSchema>;
export type ProfileSearchResponse = Static<typeof ProfileSearchResponseSchema>;

/** A friend invite (ADR-0014, SI.3). The token is shown once, at creation. */
export const FriendInviteSchema = Type.Object(
  {
    token: Type.String({ minLength: 20, maxLength: 64 }),
    /** Deep link for the share sheet and the QR code. */
    link: Type.String(),
    expiresAt: Type.String({ format: 'date-time' })
  },
  { $id: 'FriendInvite' }
);

export const FriendInviteParamsSchema = Type.Object(
  { token: Type.String({ minLength: 20, maxLength: 64 }) },
  { ...Strict, $id: 'FriendInviteParams' }
);

/** What opening someone's invite shows before accepting. */
export const FriendInvitePreviewSchema = Type.Object(
  {
    inviter: PublicProfileSchema,
    expiresAt: Type.String({ format: 'date-time' })
  },
  { $id: 'FriendInvitePreview' }
);

export const FriendInviteAcceptResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('friends'), Type.Literal('already_friends')]),
    friend: PublicProfileSchema
  },
  { $id: 'FriendInviteAcceptResponse' }
);

export type FriendInvite = Static<typeof FriendInviteSchema>;
export type FriendInvitePreview = Static<typeof FriendInvitePreviewSchema>;
export type FriendInviteAcceptResponse = Static<typeof FriendInviteAcceptResponseSchema>;
