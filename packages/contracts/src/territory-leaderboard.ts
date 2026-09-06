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

export const TerritoryLeaderboardScopeSchema = Type.Union([
  Type.Literal('individual'),
  Type.Literal('club')
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
    entries: Type.Array(TerritoryLeaderboardEntrySchema, { maxItems: 100 }),
    /** The reader's own row when it falls outside the page. */
    self: Type.Optional(TerritoryLeaderboardEntrySchema),
    /** What this board counts, in the app's own words. */
    note: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'TerritoryLeaderboardResponse' }
);

export const TerritoryLeaderboardQuerySchema = Type.Object(
  {
    scope: Type.Optional(TerritoryLeaderboardScopeSchema),
    metric: Type.Optional(TerritoryLeaderboardMetricSchema)
  },
  { ...Strict, $id: 'TerritoryLeaderboardQuery' }
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
