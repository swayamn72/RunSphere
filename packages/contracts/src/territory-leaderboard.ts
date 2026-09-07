import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';
import { CoordinateSchema, TerritoryClaimOwnerSchema } from './territory-claim.js';

/**
 * Territory leaderboards and map events (Phase 5, milestone 5.6; ADR-0011).
 *
 * These name people, like the rest of this mechanic. What they do **not** do is
 * publish anything the map does not already show: a standing is a count and an
 * area, both derivable by anyone who can pan the map. No pace, no route beyond
 * the boundaries already visible, no timestamps beyond a capture date.
 */

/**
 * What a leaderboard is ordered by.
 *
 * `defended` counts ground somebody has held through at least one challenge,
 * which rewards keeping territory rather than only taking it — without it every
 * board is a distance board wearing a different hat.
 */
export const TerritoryLeaderboardMetricSchema = Type.Union([
  Type.Literal('area'),
  Type.Literal('claims'),
  Type.Literal('defended'),
  Type.Literal('fastest')
]);

/**
 * Who a board is drawn from.
 *
 * `individual` and `club` are the original two. The three place scopes were
 * added when territory went global (pending-work 2.15): a worldwide board is
 * the only honest default once anybody can claim anywhere, but it is also the
 * one nobody can place themselves on, so a city and a country board sit in
 * front of it.
 */
export const TerritoryLeaderboardScopeSchema = Type.Union([
  Type.Literal('individual'),
  Type.Literal('club'),
  Type.Literal('city'),
  Type.Literal('country'),
  Type.Literal('global')
]);

/**
 * Which slice of time a board measures.
 *
 * `season` is the live one: ground held right now, this month. `week` reads the
 * Monday snapshot instead, so "this week" means a rank that stopped moving
 * rather than one that changes while you look at it.
 *
 * The plan asked for flat `/leaderboard/weekly` and `/leaderboard/monthly`
 * paths alongside separate `/leaderboard/city/:tag` ones. Those cannot express
 * what `screens.md` actually shows — a My City / My Country / Global switch
 * *and* a This Week / This Season switch, in combination — so period and scope
 * are two parameters on one board instead of seven endpoints that cannot be
 * crossed.
 */
export const TerritoryLeaderboardPeriodSchema = Type.Union([
  Type.Literal('season'),
  Type.Literal('week')
]);

/**
 * No `$id`: this appears twice inside one response — once in `entries` and once
 * as the reader's own row — and Fastify refuses a reference that resolves to
 * more than one schema. An embedded-only shape does not need a name.
 */
export const TerritoryLeaderboardEntrySchema = Type.Object({
  rank: Type.Integer({ minimum: 1 }),
  /** Present on an individual board. */
  owner: Type.Optional(TerritoryClaimOwnerSchema),
  /** Present on a club board. */
  club: Type.Optional(
    Type.Object({ id: UuidSchema, name: Type.String({ minLength: 1, maxLength: 80 }) })
  ),
  totalAreaSqm: Type.Number({ minimum: 0 }),
  claimCount: Type.Integer({ minimum: 0 }),
  defendedCount: Type.Integer({ minimum: 0 }),
  /** Best loop time held, when the board is ordered by it. */
  fastestSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
  isSelf: Type.Boolean()
});

export const TerritoryLeaderboardResponseSchema = Type.Object(
  {
    scope: TerritoryLeaderboardScopeSchema,
    metric: TerritoryLeaderboardMetricSchema,
    period: TerritoryLeaderboardPeriodSchema,
    /** The season this board covers, `YYYY-MM` in Asia/Kolkata. */
    seasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
    /**
     * The place this board covers, on a place scope: a city name, an ISO
     * country code, or absent on a global board.
     */
    scopeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    /**
     * True when `scopeKey` was chosen for the reader from their own claims
     * rather than asked for, so the app can say "your city" and not guess.
     */
    scopeInferred: Type.Optional(Type.Boolean()),
    entries: Type.Array(TerritoryLeaderboardEntrySchema, { maxItems: 100 }),
    /** The reader's own row when it falls outside the page. */
    self: Type.Optional(TerritoryLeaderboardEntrySchema),
    /**
     * Why a place board is empty: the reader holds no tagged ground, so there
     * is no city to show them. Distinct from a city with nobody on it.
     */
    unavailableReason: Type.Optional(Type.Literal('no_place_yet')),
    /** What this board counts, in the app's own words. */
    note: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'TerritoryLeaderboardResponse' }
);

export const TerritoryLeaderboardQuerySchema = Type.Object(
  {
    scope: Type.Optional(TerritoryLeaderboardScopeSchema),
    metric: Type.Optional(TerritoryLeaderboardMetricSchema),
    period: Type.Optional(TerritoryLeaderboardPeriodSchema),
    /**
     * Look at a named place instead of the reader's own. Omitted on a city or
     * country board means "wherever this account holds ground", which is what
     * the app's My City tab asks for.
     */
    scopeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    /** A finished season. Omitted means the one being played. */
    seasonMonth: Type.Optional(Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }))
  },
  { ...Strict, $id: 'TerritoryLeaderboardQuery' }
);

/** One finished season, for a season picker. */
export const TerritoryClaimSeasonSummarySchema = Type.Object(
  {
    seasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
    startedAt: DateTimeSchema,
    endedAt: Type.Optional(DateTimeSchema),
    /** How many claims were archived when it closed. */
    claimsArchived: Type.Integer({ minimum: 0 }),
    /** True for the season being played now, which has not ended. */
    isCurrent: Type.Boolean()
  },
  { $id: 'TerritoryClaimSeasonSummary' }
);

export const TerritoryClaimSeasonListResponseSchema = Type.Object(
  {
    data: Type.Array(TerritoryClaimSeasonSummarySchema, { maxItems: 60 }),
    /** The season being played, so the app can label the countdown. */
    currentSeasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
    /** When the current season resets, so a countdown needs no clock rules. */
    currentSeasonEndsAt: DateTimeSchema
  },
  { $id: 'TerritoryClaimSeasonListResponse' }
);

/**
 * An all-time record, and who holds it.
 *
 * Kept per place scope, because a worldwide record is unreachable for almost
 * everybody: a Mumbai record is a thing a Mumbai runner can go and beat.
 * `displayName` is copied in rather than joined, so a record survives the
 * account that set it being erased — the run happened either way.
 */
export const TerritoryHallOfFameEntrySchema = Type.Object({
  recordType: Type.Union([Type.Literal('largest_holding'), Type.Literal('largest_claim')]),
  valueSqm: Type.Number({ minimum: 0 }),
  displayName: Type.String({ minLength: 1, maxLength: 80 }),
  /** Absent once the account is erased. */
  owner: Type.Optional(TerritoryClaimOwnerSchema),
  seasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
  achievedAt: DateTimeSchema,
  /** What this record counts, said next to it. */
  note: Type.String({ minLength: 1, maxLength: 200 })
});

export const TerritoryHallOfFameResponseSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal('city'), Type.Literal('country'), Type.Literal('global')]),
    scopeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    entries: Type.Array(TerritoryHallOfFameEntrySchema, { maxItems: 20 }),
    unavailableReason: Type.Optional(Type.Literal('no_place_yet')),
    note: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'TerritoryHallOfFameResponse' }
);

export const TerritoryHallOfFameQuerySchema = Type.Object(
  {
    scope: Type.Optional(
      Type.Union([Type.Literal('city'), Type.Literal('country'), Type.Literal('global')])
    ),
    scopeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  },
  { ...Strict, $id: 'TerritoryHallOfFameQuery' }
);

/**
 * The reader's own season recap, shown once when a season resets
 * (`screens.md` 1.5).
 *
 * Absent when they held nothing: a recap that says "you finished nowhere with
 * no ground" is worse than no recap.
 */
export const TerritoryClaimSeasonRecapSchema = Type.Object(
  {
    seasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
    rank: Type.Integer({ minimum: 1 }),
    /** The place the rank is in, when their ground was tagged with one. */
    cityTag: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    peakAreaSqm: Type.Number({ minimum: 0 }),
    finalAreaSqm: Type.Number({ minimum: 0 }),
    claimCount: Type.Integer({ minimum: 0 }),
    /** Days their longest-standing claim of the season was held. */
    longestHeldDays: Type.Integer({ minimum: 0 }),
    /** Records broken in this season, in this reader's scope. */
    records: Type.Array(TerritoryHallOfFameEntrySchema, { maxItems: 6 })
  },
  { $id: 'TerritoryClaimSeasonRecap' }
);

export const TerritoryClaimSeasonRecapResponseSchema = Type.Object(
  {
    recap: Type.Optional(TerritoryClaimSeasonRecapSchema),
    /** Absent recap with a reason, so the app never shows a blank card. */
    unavailableReason: Type.Optional(
      Type.Union([Type.Literal('no_finished_season'), Type.Literal('held_nothing')])
    )
  },
  { $id: 'TerritoryClaimSeasonRecapResponse' }
);

/**
 * A map event: a bounded area and a window inside which territory counts for
 * something. Rewards are cosmetic only (`product.md`).
 */
export const TerritoryEventSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    /** The area it covers, drawn on the map. */
    boundary: Type.Array(CoordinateSchema, { minItems: 3, maxItems: 256 }),
    centroid: CoordinateSchema,
    reward: Type.String({ minLength: 1, maxLength: 200 }),
    status: Type.Union([
      Type.Literal('announced'),
      Type.Literal('live'),
      Type.Literal('ended'),
      Type.Literal('cancelled')
    ]),
    /** Claims currently held inside it. A count, never a list. */
    heldClaimCount: Type.Integer({ minimum: 0 }),
    /** How many of those are the reader's. */
    selfClaimCount: Type.Integer({ minimum: 0 })
  },
  { $id: 'TerritoryEvent' }
);

export const TerritoryEventListResponseSchema = Type.Object(
  { data: Type.Array(TerritoryEventSchema, { maxItems: 50 }) },
  { $id: 'TerritoryEventListResponse' }
);

/** Announcing an event. Staff work: the same `season_operator` role. */
export const TerritoryEventCreateRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    boundary: Type.Array(CoordinateSchema, { minItems: 3, maxItems: 256 }),
    reward: Type.String({ minLength: 1, maxLength: 200 })
  },
  { ...Strict, $id: 'TerritoryEventCreateRequest' }
);

export type TerritoryLeaderboardMetric = Static<typeof TerritoryLeaderboardMetricSchema>;
export type TerritoryLeaderboardScope = Static<typeof TerritoryLeaderboardScopeSchema>;
export type TerritoryLeaderboardPeriod = Static<typeof TerritoryLeaderboardPeriodSchema>;
export type TerritoryClaimSeasonSummary = Static<typeof TerritoryClaimSeasonSummarySchema>;
export type TerritoryClaimSeasonListResponse = Static<
  typeof TerritoryClaimSeasonListResponseSchema
>;
export type TerritoryHallOfFameEntry = Static<typeof TerritoryHallOfFameEntrySchema>;
export type TerritoryHallOfFameResponse = Static<typeof TerritoryHallOfFameResponseSchema>;
export type TerritoryHallOfFameQuery = Static<typeof TerritoryHallOfFameQuerySchema>;
export type TerritoryClaimSeasonRecap = Static<typeof TerritoryClaimSeasonRecapSchema>;
export type TerritoryClaimSeasonRecapResponse = Static<
  typeof TerritoryClaimSeasonRecapResponseSchema
>;
export type TerritoryLeaderboardEntry = Static<typeof TerritoryLeaderboardEntrySchema>;
export type TerritoryLeaderboardResponse = Static<typeof TerritoryLeaderboardResponseSchema>;
export type TerritoryLeaderboardQuery = Static<typeof TerritoryLeaderboardQuerySchema>;
export type TerritoryEvent = Static<typeof TerritoryEventSchema>;
export type TerritoryEventListResponse = Static<typeof TerritoryEventListResponseSchema>;
export type TerritoryEventCreateRequest = Static<typeof TerritoryEventCreateRequestSchema>;

/**
 * How concentrated territory holding is (milestone 5.8).
 *
 * `product.md` sets the guardrail per division, and this mechanic has no
 * divisions — so it is reported over everybody currently holding ground, and
 * `scopeNote` says so. A per-city guardrail is the one that would actually mean
 * something, and it needs a concept of a city that the data model does not have.
 */
export const TerritoryConcentrationReportSchema = Type.Object(
  {
    holders: Type.Integer({ minimum: 0 }),
    totalAreaSqm: Type.Number({ minimum: 0 }),
    topDecileShare: Type.Number({ minimum: 0, maximum: 1 }),
    topHolderShare: Type.Number({ minimum: 0, maximum: 1 }),
    /** False when the population is too small for the limits to be reachable. */
    applicable: Type.Boolean(),
    breached: Type.Boolean(),
    /** What this is measured over, said plainly. */
    scopeNote: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'TerritoryConcentrationReport' }
);

/** One piece of ground two accounts have been passing back and forth. */
export const TerritoryTradeFlagSchema = Type.Object(
  {
    id: UuidSchema,
    lineageId: UuidSchema,
    exchanges: Type.Integer({ minimum: 1 }),
    pairShare: Type.Number({ minimum: 0, maximum: 1 }),
    firstAt: DateTimeSchema,
    lastAt: DateTimeSchema,
    reviewedAt: Type.Optional(DateTimeSchema),
    reviewOutcome: Type.Optional(Type.Union([Type.Literal('upheld'), Type.Literal('dismissed')]))
  },
  { $id: 'TerritoryTradeFlag' }
);

export const TerritoryTradeFlagListResponseSchema = Type.Object(
  {
    data: Type.Array(TerritoryTradeFlagSchema, { maxItems: 100 }),
    /** Why this is a question and not a verdict. */
    note: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryTradeFlagListResponse' }
);

export const TerritoryTradeReviewRequestSchema = Type.Object(
  {
    outcome: Type.Union([Type.Literal('upheld'), Type.Literal('dismissed')]),
    note: Type.String({ minLength: 1, maxLength: 500 })
  },
  { ...Strict, $id: 'TerritoryTradeReviewRequest' }
);

export type TerritoryConcentrationReport = Static<typeof TerritoryConcentrationReportSchema>;
export type TerritoryTradeFlag = Static<typeof TerritoryTradeFlagSchema>;
export type TerritoryTradeFlagListResponse = Static<typeof TerritoryTradeFlagListResponseSchema>;
export type TerritoryTradeReviewRequest = Static<typeof TerritoryTradeReviewRequestSchema>;
