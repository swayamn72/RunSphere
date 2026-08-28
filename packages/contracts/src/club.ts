import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';
import { ProfileSchema } from './social.js';

export const ClubRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member')
]);

export const ClubSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 80 }),
    role: ClubRoleSchema,
    memberCount: Type.Integer({ minimum: 1 }),
    /** Exact invite code used for discovery; never used for public listing. */
    inviteCode: Type.String({ minLength: 6, maxLength: 32 }),
    archivedAt: Type.Optional(DateTimeSchema)
  },
  { $id: 'Club' }
);

export const ClubListResponseSchema = Type.Object(
  { data: Type.Array(ClubSchema, { maxItems: 100 }) },
  { $id: 'ClubListResponse' }
);

export const ClubCreateRequestSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 80 }) },
  { ...Strict, $id: 'ClubCreateRequest' }
);

/** Discovery is by exact invite code only; there is no public club feed or search. */
export const ClubJoinRequestSchema = Type.Object(
  { inviteCode: Type.String({ minLength: 6, maxLength: 32 }) },
  { ...Strict, $id: 'ClubJoinRequest' }
);

export const ClubMemberSchema = Type.Object(
  {
    profile: ProfileSchema,
    role: ClubRoleSchema,
    joinedAt: DateTimeSchema
  },
  { $id: 'ClubMember' }
);

export const ClubMembersResponseSchema = Type.Object(
  { data: Type.Array(ClubMemberSchema, { maxItems: 500 }) },
  { $id: 'ClubMembersResponse' }
);

/**
 * Club relays receive only aggregate completion data — never another member's
 * route, location, pace, or raw contribution details.
 */
export const ClubRelayContributionSchema = Type.Object(
  {
    id: UuidSchema,
    clubId: UuidSchema,
    accountId: UuidSchema,
    /** Capped validated minutes or quest completions, opaque to other members. */
    units: Type.Integer({ minimum: 1 }),
    periodStart: Type.String({ format: 'date' }),
    createdAt: DateTimeSchema
  },
  { $id: 'ClubRelayContribution' }
);

export type ClubRole = Static<typeof ClubRoleSchema>;
export type Club = Static<typeof ClubSchema>;
export type ClubCreateRequest = Static<typeof ClubCreateRequestSchema>;
export type ClubMember = Static<typeof ClubMemberSchema>;
export type ClubRelayContribution = Static<typeof ClubRelayContributionSchema>;
