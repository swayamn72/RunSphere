import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, DateTimeSchema, Strict, UuidSchema } from './common.js';

/**
 * Territory is an opt-in 6–8 week MMR season (ADR-0008). These read models are
 * schema-level only at the Foundation gate; territory remains disabled until
 * the Territory gate passes.
 */
export const TerritoryStatusSchema = Type.Union([
  Type.Literal('announced'),
  Type.Literal('open'),
  Type.Literal('live'),
  Type.Literal('ended')
]);

export const TerritorySeasonSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    status: TerritoryStatusSchema,
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    h3Resolution: Type.Integer({ minimum: 0, maximum: 15 }),
    scoringRuleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'TerritorySeason' }
);

export const TerritoryEnrollmentSchema = Type.Object(
  {
    seasonId: UuidSchema,
    accountId: UuidSchema,
    division: Type.String({ minLength: 1, maxLength: 64 }),
    enrolledAt: DateTimeSchema
  },
  { $id: 'TerritoryEnrollment' }
);

/**
 * Cells expose no route, timestamp, exact start/finish, or owner identity.
 * `cellIndex` is an H3 index stored as a string with pinned version metadata.
 */
export const CellContributionSchema = Type.Object(
  {
    id: UuidSchema,
    seasonId: UuidSchema,
    accountId: UuidSchema,
    cellIndex: Type.String({ minLength: 1, maxLength: 32 }),
    localDate: Type.String({ format: 'date' }),
    h3Version: Type.String({ minLength: 1, maxLength: 64 }),
    algorithmVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'CellContribution' }
);

export const CellControlSnapshotSchema = Type.Object(
  {
    seasonId: UuidSchema,
    weekStartsOn: Type.String({ format: 'date' }),
    version: Type.Integer({ minimum: 1 }),
    cellIndex: Type.String({ minLength: 1, maxLength: 32 }),
    /** Opaque participant reference; never a display identity on the map. */
    controllingParticipantRef: Type.Optional(Type.String({ maxLength: 64 })),
    createdAt: DateTimeSchema
  },
  { $id: 'CellControlSnapshot' }
);

export type TerritoryStatus = Static<typeof TerritoryStatusSchema>;
export type TerritorySeason = Static<typeof TerritorySeasonSchema>;
export type TerritoryEnrollment = Static<typeof TerritoryEnrollmentSchema>;
export type CellContribution = Static<typeof CellContributionSchema>;
export type CellControlSnapshot = Static<typeof CellControlSnapshotSchema>;

/**
 * The season as a member sees it (Phase 4, milestone 4.1).
 *
 * Everything a person needs in order to decide whether to take part, and
 * nothing about where anybody has been. `captureEnabled` is false and says so
 * out loud: a season currently records who is taking part and in which
 * division, and claims no cells at all.
 */
export const TerritorySeasonViewSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    status: TerritoryStatusSchema,
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    /** Whether this season can be joined right now. */
    joinable: Type.Boolean(),
    /** False until the Territory gate passes; the app says so where it matters. */
    captureEnabled: Type.Boolean(),
    /** How many people are taking part. A count, never a list. */
    participantCount: Type.Integer({ minimum: 0 }),
    /** The reader's own enrollment, absent when they have not joined. */
    enrollment: Type.Optional(
      Type.Object(
        {
          division: Type.String({ minLength: 1, maxLength: 64 }),
          /**
           * The band the division was read from, so an assignment can be
           * explained to the person it was made about rather than being a
           * label they cannot question.
           */
          priorActiveWeeks: Type.Integer({ minimum: 0 }),
          enrolledAt: DateTimeSchema
        },
        { $id: 'TerritoryEnrollmentView' }
      )
    ),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { $id: 'TerritorySeasonView' }
);

/**
 * The answer when no season exists or none is joinable. A season is not a
 * permanent fixture of the product, and a screen that implied one was coming
 * would be inventing a commitment nobody made.
 */
export const TerritorySeasonResponseSchema = Type.Object(
  {
    season: Type.Optional(TerritorySeasonViewSchema),
    /** Said whether or not a season exists, because it is true either way. */
    captureNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritorySeasonResponse' }
);

/**
 * Every season, for the people who run them. A member is shown one season —
 * the one they can act on — while an operator needs the ended ones too, since
 * that is where a week worth rolling back lives.
 */
export const TerritorySeasonListResponseSchema = Type.Object(
  {
    data: Type.Array(TerritorySeasonViewSchema, { maxItems: 100 }),
    captureNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritorySeasonListResponse' }
);

export const TerritoryEnrollmentRequestSchema = Type.Object(
  { enrolled: Type.Boolean() },
  { ...Strict, $id: 'TerritoryEnrollmentRequest' }
);

/** Scheduling a season. Staff work: `season_operator` or `admin`. */
export const TerritorySeasonCreateRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    h3Resolution: Type.Integer({ minimum: 0, maximum: 15 }),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { ...Strict, $id: 'TerritorySeasonCreateRequest' }
);

export const TerritorySeasonStatusRequestSchema = Type.Object(
  { status: Type.Union([Type.Literal('open'), Type.Literal('ended')]) },
  { ...Strict, $id: 'TerritorySeasonStatusRequest' }
);

/** One division's enrolled size, for planning the next season. */
export const DivisionSizeSchema = Type.Object(
  {
    division: Type.String({ minLength: 1, maxLength: 64 }),
    enrolledCount: Type.Integer({ minimum: 0 }),
    /** Advice for the next season start, never an action taken now. */
    advice: Type.Union([Type.Literal('merge'), Type.Literal('split'), Type.Literal('healthy')])
  },
  { $id: 'DivisionSize' }
);

export const DivisionSizeListResponseSchema = Type.Object(
  { data: Type.Array(DivisionSizeSchema, { maxItems: 100 }) },
  { $id: 'DivisionSizeListResponse' }
);

export const TerritorySeasonParamsSchema = Type.Object(
  { seasonId: UuidSchema },
  { ...Strict, $id: 'TerritorySeasonParams' }
);

export type TerritorySeasonView = Static<typeof TerritorySeasonViewSchema>;
export type TerritorySeasonResponse = Static<typeof TerritorySeasonResponseSchema>;
export type TerritorySeasonListResponse = Static<typeof TerritorySeasonListResponseSchema>;
export type TerritoryEnrollmentRequest = Static<typeof TerritoryEnrollmentRequestSchema>;
export type TerritorySeasonCreateRequest = Static<typeof TerritorySeasonCreateRequestSchema>;
export type TerritorySeasonStatusRequest = Static<typeof TerritorySeasonStatusRequestSchema>;
export type DivisionSize = Static<typeof DivisionSizeSchema>;
export type DivisionSizeListResponse = Static<typeof DivisionSizeListResponseSchema>;
export type TerritorySeasonParams = Static<typeof TerritorySeasonParamsSchema>;

/**
 * The season ladder (Phase 4, milestone 4.4).
 *
 * **A territory ladder carries no identities.** The global board publishes
 * display names because its score is capped active minutes — how long somebody
 * moved. A territory standing is derived from *where somebody physically went*
 * in public space, and pairing a name with it, beside a map of controlled
 * cells, would hand back exactly what ADR-0008 makes the map withhold: who
 * holds what ground. So an entry is a rank and a number of points, and the only
 * one a reader can attach a person to is their own.
 *
 * The trade is deliberate and worth naming at the Territory gate: this ladder
 * shows a participant the shape of their division and where they sit in it, and
 * it does not offer social comparison against named people. That is what the
 * opt-in global board is for.
 */
export const TerritoryLadderEntrySchema = Type.Object(
  {
    rank: Type.Integer({ minimum: 1 }),
    /** Capped control-days banked across the season (ADR-0008). */
    points: Type.Integer({ minimum: 0 }),
    /** How many closed weeks this entry scored in. Never which weeks. */
    weeksScored: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'TerritoryLadderEntry' }
);

export const TerritoryLadderResponseSchema = Type.Object(
  {
    seasonId: UuidSchema,
    /** Absent until the reader has enrolled: a division is a cohort, not a page. */
    division: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    participantCount: Type.Integer({ minimum: 0 }),
    entries: Type.Array(TerritoryLadderEntrySchema, { maxItems: 200 }),
    /** Said whether or not the ladder has anything on it. */
    captureNote: Type.String({ minLength: 1, maxLength: 400 }),
    /** Why there are no names here, in the app's own words. */
    ladderNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryLadderResponse' }
);

/**
 * One division's concentration on one day (`product.md`). Staff monitoring:
 * shares only, never the participants they were derived from.
 */
export const TerritoryConcentrationSchema = Type.Object(
  {
    division: Type.String({ minLength: 1, maxLength: 64 }),
    observedOn: DateSchema,
    participants: Type.Integer({ minimum: 0 }),
    topDecileShare: Type.Number({ minimum: 0, maximum: 1 }),
    topParticipantShare: Type.Number({ minimum: 0, maximum: 1 }),
    /** False when the division is too small for the limits to be reachable. */
    applicable: Type.Boolean(),
    breached: Type.Boolean(),
    breachRunDays: Type.Integer({ minimum: 0 }),
    /** Seven consecutive breached days: pause awards analysis and investigate. */
    pausesAwards: Type.Boolean()
  },
  { $id: 'TerritoryConcentration' }
);

export const TerritoryConcentrationListResponseSchema = Type.Object(
  { data: Type.Array(TerritoryConcentrationSchema, { maxItems: 200 }) },
  { $id: 'TerritoryConcentrationListResponse' }
);

/**
 * One finalized week and the snapshot versions it has. `currentVersion` is the
 * one being read; the others are kept and never edited, which is what makes a
 * rollback possible without rewriting history (ADR-0008).
 */
export const TerritoryWeekSchema = Type.Object(
  {
    weekStartsOn: DateSchema,
    currentVersion: Type.Integer({ minimum: 1 }),
    latestVersion: Type.Integer({ minimum: 1 }),
    finalizedAt: DateTimeSchema,
    /** Whether this week is currently showing something other than its newest snapshot. */
    rolledBack: Type.Boolean()
  },
  { $id: 'TerritoryWeek' }
);

export const TerritoryWeekListResponseSchema = Type.Object(
  { data: Type.Array(TerritoryWeekSchema, { maxItems: 100 }) },
  { $id: 'TerritoryWeekListResponse' }
);

/**
 * Rolling a week back to an earlier snapshot. The reason is required and is
 * staff-written: a participant whose week changed is owed an explanation in
 * somebody's words, not a status code.
 */
export const TerritoryWeekRollbackRequestSchema = Type.Object(
  {
    toVersion: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 500 })
  },
  { ...Strict, $id: 'TerritoryWeekRollbackRequest' }
);

export const TerritoryWeekParamsSchema = Type.Object(
  { seasonId: UuidSchema, weekStartsOn: DateSchema },
  { ...Strict, $id: 'TerritoryWeekParams' }
);

export type TerritoryLadderEntry = Static<typeof TerritoryLadderEntrySchema>;
export type TerritoryLadderResponse = Static<typeof TerritoryLadderResponseSchema>;
export type TerritoryConcentration = Static<typeof TerritoryConcentrationSchema>;
export type TerritoryConcentrationListResponse = Static<
  typeof TerritoryConcentrationListResponseSchema
>;
export type TerritoryWeek = Static<typeof TerritoryWeekSchema>;
export type TerritoryWeekListResponse = Static<typeof TerritoryWeekListResponseSchema>;
export type TerritoryWeekRollbackRequest = Static<typeof TerritoryWeekRollbackRequestSchema>;
export type TerritoryWeekParams = Static<typeof TerritoryWeekParamsSchema>;

/**
 * The season map (Phase 4, milestone 4.5).
 *
 * ADR-0008 is explicit about what another participant's cell may expose:
 * **no route, no timestamp, no exact start or finish, and no owner identity.**
 * So a cell on this map is an H3 index and one bit — whether the reader holds
 * it — and nothing else. There is no "held since", no contribution count, and
 * no way to ask who holds the ones the reader does not.
 *
 * Cells are returned as indexes rather than as polygons because that is what
 * ADR-0001 stores, and because turning an index into a boundary is the H3
 * library's job. No H3 library is a dependency of this workspace yet, so the
 * app cannot draw these and says so rather than showing an empty map that
 * looks like an unclaimed city.
 */
export const TerritoryMapCellSchema = Type.Object(
  {
    /** An H3 index at the season's pinned resolution (ADR-0001). */
    cellIndex: Type.String({ minLength: 1, maxLength: 32 }),
    /** Whether the reader holds it. Never who holds the others. */
    isSelf: Type.Boolean()
  },
  { $id: 'TerritoryMapCell' }
);

export const TerritoryMapResponseSchema = Type.Object(
  {
    seasonId: UuidSchema,
    /** The week being shown. Cells reset weekly (ADR-0008). */
    weekStartsOn: Type.Optional(DateSchema),
    /** The resolution the indexes are at, so a client cannot guess wrong. */
    h3Resolution: Type.Integer({ minimum: 0, maximum: 15 }),
    cells: Type.Array(TerritoryMapCellSchema, { maxItems: 2000 }),
    captureNote: Type.String({ minLength: 1, maxLength: 400 }),
    /** What this map does and does not show, in the app's own words. */
    mapNote: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'TerritoryMapResponse' }
);

export type TerritoryMapCell = Static<typeof TerritoryMapCellSchema>;
export type TerritoryMapResponse = Static<typeof TerritoryMapResponseSchema>;
