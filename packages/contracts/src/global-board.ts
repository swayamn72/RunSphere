import { Type, type Static } from '@sinclair/typebox';
import { DateSchema, Strict } from './common.js';
import { ProfileSchema } from './social.js';

/**
 * The opt-in global period board (Phase 3, milestone 3.5; ADR-0007).
 *
 * Global is the widest audience RunSphere has, so it is the scope with the
 * least in it: one approved display identity, one published pace-neutral
 * score, one rank, one period. Never location, route, activity timestamps or
 * details, pace, distance, or live state.
 */
export const GlobalBoardEntrySchema = Type.Object(
  {
    profile: ProfileSchema,
    /** Competition rank within the division: equal scores share a rank. */
    rank: Type.Integer({ minimum: 1 }),
    /** The single published score: whole validated active minutes, per-day capped. */
    cappedActiveMinutes: Type.Integer({ minimum: 0 }),
    isSelf: Type.Boolean()
  },
  { $id: 'GlobalBoardEntry' }
);

/**
 * The reader's own standing, for the common case where their rank falls
 * outside the page they were handed.
 *
 * It carries a rank and a score and no profile: the reader already knows who
 * they are, and repeating an identity the client holds would put one more copy
 * of a person's display identity on the wire for nothing.
 */
export const GlobalBoardSelfSchema = Type.Object(
  {
    rank: Type.Integer({ minimum: 1 }),
    cappedActiveMinutes: Type.Integer({ minimum: 0 })
  },
  { $id: 'GlobalBoardSelf' }
);

/**
 * A division is a published cohort band, not a skill rating. It is derived
 * from how many earlier weeks an account has been active — a privacy-
 * preserving activity-history band (`product.md`) — so a newcomer's first
 * week is never ranked against someone's fiftieth. It is never derived from
 * pace, distance, or place, and it is recomputed per period rather than
 * carried, so nobody is stuck in a band they have grown out of.
 */
export const GlobalBoardDivisionSchema = Type.String({ minLength: 1, maxLength: 32 });

/**
 * The board as one reader sees it.
 *
 * `entries` is the top page of the reader's own division and is empty while
 * `participating` is false: an account that is not on the board does not read
 * other people's scores. `me` is the reader's own row, which is theirs to see
 * whether or not it fits on the page, and is absent until they have a
 * qualifying score in this period.
 */
export const GlobalBoardResponseSchema = Type.Object(
  {
    periodStart: DateSchema,
    periodEnd: DateSchema,
    participating: Type.Boolean(),
    /** The reader's division for this period; absent until they are ranked. */
    division: Type.Optional(GlobalBoardDivisionSchema),
    ruleVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    /** The reader's own standing, even when it falls outside the page. */
    me: Type.Optional(GlobalBoardSelfSchema),
    entries: Type.Array(GlobalBoardEntrySchema, { maxItems: 200 })
  },
  { $id: 'GlobalBoardResponse' }
);

/**
 * Joining or leaving the global board. Off by default, separately revocable
 * from every other scope, and independent of activity visibility (ADR-0007).
 */
export const GlobalBoardParticipationRequestSchema = Type.Object(
  { participating: Type.Boolean() },
  { ...Strict, $id: 'GlobalBoardParticipationRequest' }
);

export type GlobalBoardEntry = Static<typeof GlobalBoardEntrySchema>;
export type GlobalBoardSelf = Static<typeof GlobalBoardSelfSchema>;
export type GlobalBoardResponse = Static<typeof GlobalBoardResponseSchema>;
export type GlobalBoardParticipationRequest = Static<typeof GlobalBoardParticipationRequestSchema>;
