import { Type, type Static } from '@sinclair/typebox';
import { DateTimeSchema, Strict, UuidSchema } from './common.js';

/**
 * Enclosure territory claims (Phase 5, milestone 5.1; ADR-0011).
 *
 * **These payloads carry identity and route, on purpose.** ADR-0008 kept the
 * cell map anonymous and pathless; ADR-0011 accepts the opposite trade for this
 * mechanic, because a map of who holds what is the product being built. The
 * consequences are stated where they are made rather than left to be discovered:
 *
 * - `boundary` is the loop the holder ran. Anyone who can see the claim can see
 *   that path.
 * - `owner` names the holder and carries their avatar.
 * - `durationSeconds` is published so a rival knows the time to beat.
 */

/** Longitude then latitude, GeoJSON order. */
export const CoordinateSchema = Type.Tuple([
  Type.Number({ minimum: -180, maximum: 180 }),
  Type.Number({ minimum: -90, maximum: 90 })
]);

/**
 * The holder as the map shows them: the same display identity every other
 * social surface uses, and nothing more. No email, no account contact details.
 */
export const TerritoryClaimOwnerSchema = Type.Object(
  {
    id: UuidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 40 }),
    avatarKey: Type.String({ minLength: 1, maxLength: 64 }),
    /** So the app can mark the reader's own ground without comparing ids. */
    isSelf: Type.Boolean()
  }
  // No `$id`: the leaderboard embeds this twice in one response — the page and
  // the reader's own row — and Fastify refuses a reference that resolves to
  // more than one schema.
);

export const TerritoryClaimSchema = Type.Object(
  {
    id: UuidSchema,
    owner: TerritoryClaimOwnerSchema,
    /** The closed loop, as drawn. Bounded so one claim cannot flood a viewport. */
    boundary: Type.Array(CoordinateSchema, { minItems: 3, maxItems: 256 }),
    /** Where the holder's avatar sits. */
    centroid: CoordinateSchema,
    areaSqm: Type.Number({ minimum: 0 }),
    /** Length of the loop. What a challenger has to run, so it is published. */
    distanceMetres: Type.Optional(Type.Number({ minimum: 0 })),
    /** The time to beat. Published because the contest is meaningless hidden. */
    durationSeconds: Type.Integer({ minimum: 1 }),
    /** How many times this ground has changed hands. A first claim is 1. */
    captureCount: Type.Integer({ minimum: 1 }),
    /**
     * `owned` by a person, `club_controlled` when claimed for a club, and
     * `contested` when the ground has changed hands more than once recently —
     * a piece of the map people are actively fighting over.
     */
    status: Type.Union([
      Type.Literal('owned'),
      Type.Literal('club_controlled'),
      Type.Literal('contested')
    ]),
    /** The club the holder claimed for, when they claimed for one. */
    club: Type.Optional(
      Type.Object(
        { id: UuidSchema, name: Type.String({ minLength: 1, maxLength: 80 }) },
        { $id: 'TerritoryClaimClub' }
      )
    ),
    claimedAt: DateTimeSchema
  },
  { $id: 'TerritoryClaim' }
);

/** One owner in a territory's story, oldest first. */
export const TerritoryClaimHistoryEntrySchema = Type.Object(
  {
    claimId: UuidSchema,
    owner: Type.Optional(TerritoryClaimOwnerSchema),
    durationSeconds: Type.Integer({ minimum: 1 }),
    areaSqm: Type.Number({ minimum: 0 }),
    claimedAt: DateTimeSchema,
    /** Absent while this is the current holder. */
    releasedAt: Type.Optional(DateTimeSchema)
  },
  { $id: 'TerritoryClaimHistoryEntry' }
);

export const TerritoryClaimHistoryResponseSchema = Type.Object(
  {
    lineageId: UuidSchema,
    captureCount: Type.Integer({ minimum: 0 }),
    /** The best time anybody has held this ground with. */
    recordSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Every challenge this ground has seen: takeovers plus failed attempts. */
    battleCount: Type.Integer({ minimum: 0 }),
    /** Attempts that did not beat the holder's time. */
    defendedCount: Type.Integer({ minimum: 0 }),
    entries: Type.Array(TerritoryClaimHistoryEntrySchema, { maxItems: 100 })
  },
  { $id: 'TerritoryClaimHistoryResponse' }
);

/**
 * A generalised blob of activity for a zoomed-out map (world and region views).
 *
 * Individual claims are not sent at these zooms: thousands of tiny polygons is
 * a slow response and an unreadable picture. A cluster is a point, a count, and
 * an area — enough to show where the game is being played, and not enough to
 * locate any one person.
 */
export const TerritoryClusterSchema = Type.Object(
  {
    centroid: CoordinateSchema,
    claimCount: Type.Integer({ minimum: 1 }),
    totalAreaSqm: Type.Number({ minimum: 0 }),
    /** How many distinct people hold ground here. */
    holderCount: Type.Integer({ minimum: 1 }),
    /** True when any of it is the reader's, so their own cities stand out. */
    includesSelf: Type.Boolean()
  },
  { $id: 'TerritoryCluster' }
);

export const TerritoryClusterListResponseSchema = Type.Object(
  { clusters: Type.Array(TerritoryClusterSchema, { maxItems: 500 }) },
  { $id: 'TerritoryClusterListResponse' }
);

/** One suggested territory, with the estimate stated as an estimate. */
export const TerritoryRecommendationSchema = Type.Object(
  {
    claim: TerritoryClaimSchema,
    distanceMetres: Type.Number({ minimum: 0 }),
    targetSeconds: Type.Integer({ minimum: 1 }),
    estimatedSeconds: Type.Integer({ minimum: 0 }),
    successProbability: Type.Number({ minimum: 0, maximum: 1 }),
    difficulty: Type.Union([Type.Literal('comfortable'), Type.Literal('stretch')]),
    /** Ground per metre run, 0–1. A circle is 1; a long thin loop nears 0. */
    efficiency: Type.Number({ minimum: 0, maximum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryRecommendation' }
);

export const TerritoryRecommendationResponseSchema = Type.Object(
  {
    data: Type.Array(TerritoryRecommendationSchema, { maxItems: 3 }),
    /** Present when there is not enough history to estimate anything. */
    unavailableReason: Type.Optional(Type.Literal('not_enough_runs')),
    /** Shown wherever a recommendation is: this is a guess, not a promise. */
    note: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryRecommendationResponse' }
);

/**
 * Everything held inside the viewport the app is showing.
 *
 * Bounded by count as well as by viewport: zoomed out over a city the answer
 * would otherwise be every claim in it, which is a slow response and a worse
 * map. `truncated` says when that happened so the app can tell somebody to zoom
 * in rather than silently showing them a fraction of the ground.
 */
export const TerritoryClaimMapResponseSchema = Type.Object(
  {
    claims: Type.Array(TerritoryClaimSchema, { maxItems: 400 }),
    truncated: Type.Boolean(),
    /** What this map shows about people, said where the map is fetched. */
    mapNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryClaimMapResponse' }
);

/** A viewport. All four are required: a half-specified box is a bug, not a default. */
export const TerritoryClaimBoundsSchema = Type.Object(
  {
    west: Type.Number({ minimum: -180, maximum: 180 }),
    south: Type.Number({ minimum: -90, maximum: 90 }),
    east: Type.Number({ minimum: -180, maximum: 180 }),
    north: Type.Number({ minimum: -90, maximum: 90 })
  },
  { ...Strict, $id: 'TerritoryClaimBounds' }
);

/** Claiming from a run that has already been validated and derived. */
export const TerritoryClaimRequestSchema = Type.Object(
  { activityId: UuidSchema },
  { ...Strict, $id: 'TerritoryClaimRequest' }
);

/**
 * What happened to a run.
 *
 * A refusal is a normal outcome — most runs are not loops — so this is a 200
 * with a reason rather than an error status. `message` is the words the app
 * shows; `refusal` is the code it branches on.
 */
export const TerritoryClaimResultSchema = Type.Object(
  {
    claimed: Type.Boolean(),
    claim: Type.Optional(TerritoryClaimSchema),
    refusal: Type.Optional(
      Type.Union([
        Type.Literal('not_closed'),
        Type.Literal('too_few_points'),
        Type.Literal('too_small'),
        Type.Literal('too_large'),
        Type.Literal('no_duration'),
        Type.Literal('slower_than_holder'),
        /** The trace could not have been run. See `run-integrity.ts`. */
        Type.Literal('run_integrity'),
        /** The loop passes through one of the claimant's own privacy zones. */
        Type.Literal('privacy_zone')
      ])
    ),
    message: Type.String({ minLength: 1, maxLength: 400 }),
    /** How many people lost ground to this run. */
    takenOverCount: Type.Integer({ minimum: 0 }),
    /**
     * True on an account's first ever claim, so the app can say once — at the
     * moment it becomes true — that this puts a loop on a public map, and point
     * at privacy zones. A zone only protects somebody who made one.
     */
    isFirstClaim: Type.Boolean()
  },
  { $id: 'TerritoryClaimResult' }
);

/** One line of "who took what from whom", for the holder who lost it. */
export const TerritoryClaimActivityItemSchema = Type.Object(
  {
    id: UuidSchema,
    /** Absent once the other account is erased; the event still happened. */
    rival: Type.Optional(TerritoryClaimOwnerSchema),
    previousDurationSeconds: Type.Integer({ minimum: 1 }),
    newDurationSeconds: Type.Integer({ minimum: 1 }),
    takenFromSelf: Type.Boolean(),
    createdAt: DateTimeSchema
  },
  { $id: 'TerritoryClaimActivityItem' }
);

export const TerritoryClaimActivityResponseSchema = Type.Object(
  { data: Type.Array(TerritoryClaimActivityItemSchema, { maxItems: 100 }) },
  { $id: 'TerritoryClaimActivityResponse' }
);

/** The reader's own standing in this mechanic: ground held, not a ladder rank. */
export const TerritoryClaimSummarySchema = Type.Object(
  {
    claimCount: Type.Integer({ minimum: 0 }),
    totalAreaSqm: Type.Number({ minimum: 0 }),
    /** Claims of theirs that somebody else has taken. */
    lostCount: Type.Integer({ minimum: 0 })
  },
  { $id: 'TerritoryClaimSummary' }
);

export type Coordinate = Static<typeof CoordinateSchema>;
export type TerritoryClaimOwner = Static<typeof TerritoryClaimOwnerSchema>;
export type TerritoryClaim = Static<typeof TerritoryClaimSchema>;
export type TerritoryClaimMapResponse = Static<typeof TerritoryClaimMapResponseSchema>;
export type TerritoryClaimBounds = Static<typeof TerritoryClaimBoundsSchema>;
export type TerritoryClaimRequest = Static<typeof TerritoryClaimRequestSchema>;
export type TerritoryClaimResult = Static<typeof TerritoryClaimResultSchema>;
export type TerritoryClaimActivityItem = Static<typeof TerritoryClaimActivityItemSchema>;
export type TerritoryClaimActivityResponse = Static<typeof TerritoryClaimActivityResponseSchema>;
export type TerritoryClaimSummary = Static<typeof TerritoryClaimSummarySchema>;
export type TerritoryClaimHistoryEntry = Static<typeof TerritoryClaimHistoryEntrySchema>;
export type TerritoryClaimHistoryResponse = Static<typeof TerritoryClaimHistoryResponseSchema>;
export type TerritoryCluster = Static<typeof TerritoryClusterSchema>;
export type TerritoryClusterListResponse = Static<typeof TerritoryClusterListResponseSchema>;
export type TerritoryRecommendation = Static<typeof TerritoryRecommendationSchema>;
export type TerritoryRecommendationResponse = Static<typeof TerritoryRecommendationResponseSchema>;
