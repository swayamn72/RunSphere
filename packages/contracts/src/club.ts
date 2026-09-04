import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, Strict, UuidSchema } from './common.js';
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
 * The worker's internal per-member relay record, kept so a club total is
 * auditable and recomputable. **No route returns this**: a club receives
 * aggregate completion data only, so a member sees `ClubRelaySummary` — the
 * shared totals plus their own units — and never another member's row
 * (`safety-and-privacy.md`).
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

export const ClubParamsSchema = Type.Object(
  { clubId: UuidSchema },
  { ...Strict, $id: 'ClubParams' }
);

export const ClubMemberParamsSchema = Type.Object(
  { clubId: UuidSchema, accountId: UuidSchema },
  { ...Strict, $id: 'ClubMemberParams' }
);

/**
 * Role changes are limited to the two roles a club can grant. `owner` is
 * absent on purpose: there is exactly one owner per club, and handing that
 * over is a transfer with its own consequences, not a role edit.
 */
export const ClubMemberRoleUpdateRequestSchema = Type.Object(
  { role: Type.Union([Type.Literal('admin'), Type.Literal('member')]) },
  { ...Strict, $id: 'ClubMemberRoleUpdateRequest' }
);

export type ClubJoinRequest = Static<typeof ClubJoinRequestSchema>;
export type ClubListResponse = Static<typeof ClubListResponseSchema>;
export type ClubMembersResponse = Static<typeof ClubMembersResponseSchema>;
export type ClubParams = Static<typeof ClubParamsSchema>;
export type ClubMemberParams = Static<typeof ClubMemberParamsSchema>;
export type ClubMemberRoleUpdateRequest = Static<typeof ClubMemberRoleUpdateRequestSchema>;

/**
 * A relay as any member may see it: the club's shared totals plus the reader's
 * own contribution, and nothing else. There is deliberately no per-member
 * breakdown — a club receives aggregate completion data only
 * (`safety-and-privacy.md`), so another member's contribution has no
 * representation in this contract at all.
 */
export const ClubRelaySummarySchema = Type.Object(
  {
    id: UuidSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    targetUnits: Type.Integer({ minimum: 1 }),
    /** Capped validated active minutes contributed by the whole club. */
    totalUnits: Type.Integer({ minimum: 0 }),
    /** The reader's own contribution. Their own data, so it is theirs to see. */
    myUnits: Type.Integer({ minimum: 0 }),
    /** How many members contributed anything. A count, never a list. */
    contributorCount: Type.Integer({ minimum: 0 }),
    progressPercent: Type.Integer({ minimum: 0, maximum: 100 }),
    goalMet: Type.Boolean(),
    /** True while the week is open and the totals can still move. */
    current: Type.Boolean(),
    ruleVersion: Type.Integer({ minimum: 1 })
  },
  { $id: 'ClubRelaySummary' }
);

export const ClubRelayListResponseSchema = Type.Object(
  { data: Type.Array(ClubRelaySummarySchema, { maxItems: 52 }) },
  { $id: 'ClubRelayListResponse' }
);

/**
 * The week is not a parameter: a relay is always set for the open week, so a
 * target can never be added to a week that has already been scored.
 */
export const ClubRelayCreateRequestSchema = Type.Object(
  { targetUnits: Type.Integer({ minimum: 1, maximum: 1_000_000 }) },
  { ...Strict, $id: 'ClubRelayCreateRequest' }
);

export type ClubRelaySummary = Static<typeof ClubRelaySummarySchema>;
export type ClubRelayListResponse = Static<typeof ClubRelayListResponseSchema>;
export type ClubRelayCreateRequest = Static<typeof ClubRelayCreateRequestSchema>;
