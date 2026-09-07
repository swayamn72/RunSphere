import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, Strict, UuidSchema } from './common.js';

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
    /** Ground held. After a carve this is the surviving cells, not the original loop. */
    areaSqm: Type.Number({ minimum: 0 }),
    /**
     * Length of the loop the holder ran. The numerator of `speedMps`, and what
     * a challenger's effort allowance is measured against, so it is published.
     */
    distanceMetres: Type.Number({ minimum: 0 }),
    /** How long that loop took them. */
    durationSeconds: Type.Integer({ minimum: 1 }),
    /**
     * The number to beat: perimeter over duration.
     *
     * Sent derived rather than left to the app to divide, because it is the
     * single quantity the contest turns on and two clients computing it
     * differently would show two different targets for the same ground.
     */
    speedMps: Type.Number({ minimum: 0 }),
    /** `YYYY-MM` in Asia/Kolkata. Claims expire with their month. */
    seasonMonth: Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' }),
    /**
     * Where this ground is, coarsely — the same tags the boards group by.
     *
     * Absent when no geocode was available for the area, which happens outside
     * the seeded launch market until a proxy is configured. An untagged claim
     * is real held ground; it is simply missing from its city board.
     */
    cityTag: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    countryTag: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })),
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
 * One contest this run had with one existing holder.
 *
 * The post-run screen shows these line by line, won and lost together, with the
 * numbers behind each verdict (`screens.md` LR.3). Publishing the losing side's
 * reasoning is the point: a mechanic that silently declines to hand over ground
 * reads as broken, and "his speed was 3.70, your effective speed was 3.54 after
 * a 10% allowance" is a sentence somebody can act on.
 */
export const TerritoryCarveSchema = Type.Object(
  {
    /** True when the ground changed hands. */
    carved: Type.Boolean(),
    /** The holder, by display identity only. Absent if their profile is gone. */
    holder: Type.Optional(TerritoryClaimOwnerSchema),
    /** Ground taken from them, 0 on a failed challenge. */
    areaSqm: Type.Number({ minimum: 0 }),
    /** The challenger's raw speed, before the effort allowance. */
    yourSpeedMps: Type.Number({ minimum: 0 }),
    /** Their speed, which is what had to be beaten. */
    theirSpeedMps: Type.Number({ minimum: 0 }),
    /** The allowance the longer loop earned, 0 to 0.15. */
    graceApplied: Type.Number({ minimum: 0, maximum: 0.15 }),
    /** `yourSpeedMps` with the allowance applied. The number that was compared. */
    effectiveSpeedMps: Type.Number({ minimum: 0 }),
    /** True when the holder lost everything and their claim was released whole. */
    holderWipedOut: Type.Boolean(),
    /**
     * Present when the contest never ran because the shared ground was under
     * the carve floor. Not a defeat, and should not be worded as one.
     */
    overlapTooSmall: Type.Boolean()
  },
  { $id: 'TerritoryCarve' }
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
    /**
     * Every contest, carried on a refusal as well as on a claim: a run that
     * came away with nothing still needs to say who held the ground and by how
     * much they were faster.
     */
    carves: Type.Array(TerritoryCarveSchema, { maxItems: 50 }),
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
    /** Ground taken from other people by this run, in square metres. */
    carvedAreaSqm: Type.Number({ minimum: 0 }),
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

/**
 * Ghost Race (`territory-guide.md`; `screens.md` 1.4 and LR.1).
 *
 * The holder's loop, trimmed and timed, so a challenger can race the pace it
 * was actually run at. **A motivational layer and nothing more** — the carving
 * rules are identical whether a ghost was on screen or not.
 *
 * What this discloses beyond the claim itself: pacing *within* the loop. The
 * route, the perimeter, and the average pace are already on `TerritoryClaim`
 * for anybody who can see the map.
 */
export const GhostPointSchema = Type.Object(
  {
    /** Longitude then latitude, GeoJSON order, like every other coordinate. */
    at: CoordinateSchema,
    /** Seconds from the first point of the trimmed trace, so it starts at 0. */
    elapsedSeconds: Type.Integer({ minimum: 0 })
  },
  { $id: 'GhostPoint' }
);

export const GhostTraceResponseSchema = Type.Object(
  {
    /** The claim being raced, so a client cannot mix up two ghosts. */
    claimId: UuidSchema,
    /** Whose run it is. Display identity only, as everywhere else. */
    owner: TerritoryClaimOwnerSchema,
    points: Type.Array(GhostPointSchema, { minItems: 4, maxItems: 2048 }),
    /** Along the trimmed trace. Always less than the claim's perimeter. */
    distanceMetres: Type.Number({ minimum: 0 }),
    /** Along the trimmed trace. Always less than the claim's duration. */
    durationSeconds: Type.Integer({ minimum: 1 }),
    /** How much was cut from each end, so the app can state it in metres. */
    trimMetres: Type.Integer({ minimum: 0 }),
    /**
     * When the run happened, so nobody races a ghost from three weeks ago
     * without knowing it. Date only — the time of day is not published,
     * because when somebody runs is a routine.
     */
    recordedOn: DateSchema,
    /** Said wherever a ghost is offered: what was trimmed, and that no rule changed. */
    privacyNote: Type.String({ minLength: 1, maxLength: 300 }),
    rulesNote: Type.String({ minLength: 1, maxLength: 300 }),
    /** Views left in this hour after this one, so the app can stop offering it. */
    viewsRemaining: Type.Integer({ minimum: 0 })
  },
  { $id: 'GhostTraceResponse' }
);

/**
 * Why a ghost is not available, in a shape the app can turn into words.
 *
 * `rate_limited` is answered with 429 and the rest with 404 or 409 — but the
 * body carries the reason either way, because "unavailable" with no
 * explanation is what makes somebody tap a button four more times.
 */
export const GhostTraceUnavailableSchema = Type.Object(
  {
    reason: Type.Union([
      Type.Literal('no_trace'),
      Type.Literal('own_claim'),
      Type.Literal('not_held'),
      Type.Literal('out_of_region'),
      Type.Literal('rate_limited')
    ]),
    message: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'GhostTraceUnavailable' }
);

export type Coordinate = Static<typeof CoordinateSchema>;
export type TerritoryClaimOwner = Static<typeof TerritoryClaimOwnerSchema>;
export type TerritoryClaim = Static<typeof TerritoryClaimSchema>;
export type TerritoryClaimMapResponse = Static<typeof TerritoryClaimMapResponseSchema>;
export type TerritoryClaimBounds = Static<typeof TerritoryClaimBoundsSchema>;
export type TerritoryClaimRequest = Static<typeof TerritoryClaimRequestSchema>;
export type TerritoryCarve = Static<typeof TerritoryCarveSchema>;
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
export type GhostPoint = Static<typeof GhostPointSchema>;
export type GhostTraceResponse = Static<typeof GhostTraceResponseSchema>;
export type GhostTraceUnavailable = Static<typeof GhostTraceUnavailableSchema>;
