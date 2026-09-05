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

/**
 * One club-board entry (ADR-0007). A board entry carries an approved display
 * identity, one published pace-neutral score, and a rank — never location,
 * route, activity timestamps, pace, distance, or live state.
 *
 * This is the same privacy-minimized projection the friend board publishes,
 * deliberately: a board entry means the same thing wherever it is read, and a
 * club board is a board with a narrower audience rather than a different kind
 * of disclosure.
 */
export const ClubBoardEntrySchema = Type.Object(
  {
    profile: ProfileSchema,
    /** Competition rank: equal scores share a rank and the next rank skips. */
    rank: Type.Integer({ minimum: 1 }),
    /** The single published score: whole validated active minutes, per-day capped. */
    cappedActiveMinutes: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'ClubBoardEntry' }
);

/**
 * The club's weekly board, isolated by `club_id` and readable only by an
 * active member (ADR-0007). Two gates stand in front of `entries`: membership
 * in this club, and the reader's own live opt-in. `entries` is empty while
 * `participating` is false — an account that is not on the board does not read
 * other members' scores.
 *
 * A board entry is a *published aggregate the member chose to publish*, which
 * is what separates it from a relay contribution: relay minutes are counted
 * whether or not you asked, so they stay aggregate forever
 * (`ClubRelaySummary`), while a board score is opt-in and revocable.
 */
export const ClubBoardResponseSchema = Type.Object(
  {
    clubId: UuidSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    participating: Type.Boolean(),
    ruleVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    entries: Type.Array(ClubBoardEntrySchema, { maxItems: 500 })
  },
  { $id: 'ClubBoardResponse' }
);

/**
 * Joining or leaving club boards. The decision is one row per account in the
 * `club` scope, independent of the `friends` scope (ADR-0007) and of activity
 * visibility, and it covers every club the account is an active member of —
 * the audience is already bounded by the clubs they chose to join, and a
 * per-club switch would publish the same score to a strictly smaller audience
 * while doubling the number of controls a member has to reason about.
 */
export const ClubBoardParticipationRequestSchema = Type.Object(
  { participating: Type.Boolean() },
  { ...Strict, $id: 'ClubBoardParticipationRequest' }
);

export type ClubBoardEntry = Static<typeof ClubBoardEntrySchema>;
export type ClubBoardResponse = Static<typeof ClubBoardResponseSchema>;
export type ClubBoardParticipationRequest = Static<typeof ClubBoardParticipationRequestSchema>;

/**
 * A club challenge's scoreable modes (milestone 3.4). The same pace-neutral
 * modes the 1v1 rule enables, and `quest_completion` is absent for the same
 * reason: nothing records a quest completion, so the mode would score every
 * member zero.
 */
export const ClubChallengeModeSchema = Type.Union([
  Type.Literal('active_minutes'),
  Type.Literal('active_days')
]);

export const ClubChallengeStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('finished'),
  Type.Literal('cancelled')
]);

/**
 * One club challenge as any member of that club may see it.
 *
 * `participantCount` is a count and never a list: who is in the contest is
 * shown by the standings, which a member reads only once they are in it
 * themselves. `joined` is the reader's own state, so it is theirs to see.
 */
export const ClubChallengeSummarySchema = Type.Object(
  {
    id: UuidSchema,
    clubId: UuidSchema,
    mode: ClubChallengeModeSchema,
    lengthDays: Type.Integer({ minimum: 1, maximum: 31 }),
    status: ClubChallengeStatusSchema,
    periodStart: DateSchema,
    periodEnd: DateSchema,
    /** How many members are currently in the contest. A count, never a list. */
    participantCount: Type.Integer({ minimum: 0 }),
    /** Whether the reader is currently in it. Their own state. */
    joined: Type.Boolean(),
    ruleVersion: Type.Integer({ minimum: 1 }),
    createdAt: DateTimeSchema
  },
  { $id: 'ClubChallengeSummary' }
);

export const ClubChallengeListResponseSchema = Type.Object(
  { data: Type.Array(ClubChallengeSummarySchema, { maxItems: 50 }) },
  { $id: 'ClubChallengeListResponse' }
);

/**
 * Opening a challenge. The window is never a parameter: a challenge starts the
 * day it is opened and runs `lengthDays`, so a contest can neither be
 * backdated over days that have already happened nor parked in the future.
 * A length or mode the published rule does not allow is a `422` — the request
 * is well-formed, the rule simply does not permit it.
 */
export const ClubChallengeCreateRequestSchema = Type.Object(
  {
    mode: ClubChallengeModeSchema,
    lengthDays: Type.Integer({ minimum: 1, maximum: 31 })
  },
  { ...Strict, $id: 'ClubChallengeCreateRequest' }
);

/**
 * Joining or leaving one challenge. Unlike the club board's account-level
 * scope, this consent is per contest and revocable on its own: joining
 * publishes your score for this window to the members who are also in it, and
 * leaving stops it being counted or shown from that moment.
 */
export const ClubChallengeParticipationRequestSchema = Type.Object(
  { participating: Type.Boolean() },
  { ...Strict, $id: 'ClubChallengeParticipationRequest' }
);

/**
 * One standing in a club challenge — the same privacy-minimized projection
 * every other board entry uses: an approved display identity, one published
 * pace-neutral score, and a rank. Never location, route, activity timestamps,
 * pace, distance, or live state.
 */
export const ClubChallengeStandingSchema = Type.Object(
  {
    profile: ProfileSchema,
    /** Competition rank: equal scores share a rank and the next rank skips. */
    rank: Type.Integer({ minimum: 1 }),
    /** Capped active minutes or active days, depending on the challenge mode. */
    score: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'ClubChallengeStanding' }
);

/**
 * The standings of one challenge. `joined` gates `entries` exactly as the club
 * board's opt-in does: reading the other participants' scores means having
 * published your own. `final` is true once the worker has stored the result,
 * after which the numbers never change.
 */
export const ClubChallengeStandingsResponseSchema = Type.Object(
  {
    challenge: ClubChallengeSummarySchema,
    /** True once the window has closed and the stored result is what is shown. */
    final: Type.Boolean(),
    entries: Type.Array(ClubChallengeStandingSchema, { maxItems: 500 })
  },
  { $id: 'ClubChallengeStandingsResponse' }
);

export const ClubChallengeParamsSchema = Type.Object(
  { clubId: UuidSchema, challengeId: UuidSchema },
  { ...Strict, $id: 'ClubChallengeParams' }
);

export type ClubChallengeMode = Static<typeof ClubChallengeModeSchema>;
export type ClubChallengeStatus = Static<typeof ClubChallengeStatusSchema>;
export type ClubChallengeSummary = Static<typeof ClubChallengeSummarySchema>;
export type ClubChallengeListResponse = Static<typeof ClubChallengeListResponseSchema>;
export type ClubChallengeCreateRequest = Static<typeof ClubChallengeCreateRequestSchema>;
export type ClubChallengeParticipationRequest = Static<
  typeof ClubChallengeParticipationRequestSchema
>;
export type ClubChallengeStanding = Static<typeof ClubChallengeStandingSchema>;
export type ClubChallengeStandingsResponse = Static<typeof ClubChallengeStandingsResponseSchema>;
export type ClubChallengeParams = Static<typeof ClubChallengeParamsSchema>;
