import { kolkataDate, kolkataDateStart, weeklyPeriodStart } from './gamification.js';

/**
 * Territory weeks, the season ladder, and the concentration guardrails
 * (Phase 4, milestones 4.3, 4.4 and 4.6; ADR-0006, ADR-0008, `product.md`).
 *
 * Everything here is a pure function over already-derived numbers. Nothing
 * reads a location, a pace, or a distance: a week is a span of Kolkata days, a
 * ladder is a sum of capped control-days, and a guardrail is a share of points
 * within one division.
 *
 * As with the rest of territory, none of it runs — `TERRITORY_CAPTURE_ENABLED`
 * is false and no contribution exists to aggregate. It is written now so the
 * rules can be reviewed at the Territory gate rather than after it.
 */

const MILLIS_PER_DAY = 86_400_000;

/**
 * Whether the Kolkata week beginning `weekStartsOn` has completely ended.
 *
 * A week is snapshotted only after it is over. Snapshotting a week in progress
 * would publish a standing that is about to change, and ADR-0006 makes weekly
 * periods immutable once written — a partial week would make the first version
 * of every week wrong by construction.
 */
export const territoryWeekClosed = (weekStartsOn: string, now: Date): boolean =>
  now.getTime() >= kolkataDateStart(weekStartsOn).getTime() + 7 * MILLIS_PER_DAY;

/** The Kolkata Monday a date falls in, as `YYYY-MM-DD`. */
export const territoryWeekOf = (instant: Date): string => kolkataDate(weeklyPeriodStart(instant));

/**
 * Every week of a season that has closed by `now`, earliest first.
 *
 * A season's weeks are derived from its own dates rather than from whatever
 * contributions happen to exist, so a week nobody moved in is still a week that
 * gets a snapshot — an empty snapshot is a fact about the season, and its
 * absence would be indistinguishable from a scoring job that never ran.
 */
export const closedTerritoryWeeks = (startsAt: Date, endsAt: Date, now: Date): string[] => {
  const weeks: string[] = [];
  const last = Math.min(endsAt.getTime(), now.getTime());
  let cursor = weeklyPeriodStart(startsAt).getTime();
  // A season longer than two years is a data error, not a season; the bound
  // stops a bad `ends_at` turning this into an unbounded loop.
  for (let guard = 0; guard < 120 && cursor <= last; guard += 1) {
    const week = kolkataDate(new Date(cursor));
    if (territoryWeekClosed(week, now)) weeks.push(week);
    cursor = kolkataDateStart(week).getTime() + 7 * MILLIS_PER_DAY;
  }
  return weeks;
};

/**
 * **Cells reset to unclaimed every week** (ADR-0008), and that reset is
 * structural rather than an action: control is stored per week, so a new week
 * simply has no control rows until its own contributions are resolved. There is
 * deliberately no job that deletes last week's control — history is kept, and
 * what resets is what the *current* week shows.
 *
 * This constant exists to state that in code, and it is what a test asserts:
 * control never carries forward.
 */
export const territoryControlCarriesForward = false;

/** One participant's banked points for a single week. */
export interface WeeklyLadderRow {
  participantRef: string;
  weekStartsOn: string;
  points: number;
}

export interface SeasonStanding {
  participantRef: string;
  points: number;
  /** Competition ranking: equal points share a rank and the next rank skips. */
  rank: number;
  /** How many of the season's closed weeks this participant banked points in. */
  weeksScored: number;
}

/**
 * Season standings from weekly rows.
 *
 * Points accumulate across the season while cells reset weekly (ADR-0008), so
 * this is a sum and never a recomputation of control. Equal points share a
 * rank, because splitting a tie on something the participants cannot see would
 * be inventing a difference the rules do not make; the ordering *within* a tie
 * is by the opaque reference, purely so the same input always renders in the
 * same order.
 */
export const seasonStandings = (rows: readonly WeeklyLadderRow[]): SeasonStanding[] => {
  const totals = new Map<string, { points: number; weeks: Set<string> }>();
  for (const row of rows) {
    const entry = totals.get(row.participantRef) ?? { points: 0, weeks: new Set<string>() };
    entry.points += Math.max(0, Math.trunc(row.points));
    if (row.points > 0) entry.weeks.add(row.weekStartsOn);
    totals.set(row.participantRef, entry);
  }
  const ordered = [...totals.entries()]
    .map(([participantRef, entry]) => ({
      participantRef,
      points: entry.points,
      weeksScored: entry.weeks.size
    }))
    .sort(
      (left, right) =>
        right.points - left.points || left.participantRef.localeCompare(right.participantRef)
    );

  let rank = 0;
  let previousPoints: number | undefined;
  return ordered.map((entry, index) => {
    if (entry.points !== previousPoints) {
      rank = index + 1;
      previousPoints = entry.points;
    }
    return { ...entry, rank };
  });
};

/**
 * The winner-concentration baselines from `product.md`: within any division the
 * top 10% should hold no more than 35% of cumulative territory points, and the
 * single top participant no more than 8%. Breached for seven consecutive days,
 * awards analysis pauses and cell scarcity and validation abuse are
 * investigated before the next release.
 */
export const TERRITORY_CONCENTRATION_LIMITS = {
  topDecileShare: 0.35,
  topParticipantShare: 0.08,
  sustainedBreachDays: 7
} as const;

export interface DivisionConcentration {
  participants: number;
  totalPoints: number;
  topDecileShare: number;
  topParticipantShare: number;
  /**
   * False when a guardrail is arithmetically unreachable at this division size
   * — see `concentrationApplies`. A guardrail that cannot be met is not a
   * finding about the season, and reporting it as a breach every day would bury
   * the real ones.
   */
  applicable: boolean;
  breached: boolean;
}

/**
 * Whether the concentration guardrails can be satisfied at all at this size.
 *
 * The top-participant limit is 8%, so in a division of twelve an exactly even
 * split already sits above it: the smallest possible share is `1/n`. The
 * top-decile limit has the same shape — the smallest possible share is
 * `ceil(n/10)/n`, which exceeds 35% for a division of two. Below those sizes
 * the guardrail says nothing about fairness, only about arithmetic.
 *
 * A division that small is far outside the 100–250 target `product.md` sets and
 * below the merge-at-40 floor, so in practice this reports a division that
 * should have been merged rather than one that is concentrated.
 */
export const concentrationApplies = (participants: number): boolean => {
  if (participants < 1) return false;
  const decileFloor = Math.ceil(participants / 10) / participants;
  return (
    1 / participants <= TERRITORY_CONCENTRATION_LIMITS.topParticipantShare &&
    decileFloor <= TERRITORY_CONCENTRATION_LIMITS.topDecileShare
  );
};

/**
 * One division's concentration on one day, from that division's cumulative
 * season points.
 *
 * Shares are of *points held*, never of cells, distance, or time: the guardrail
 * asks whether a few people are taking the season, and points are what the
 * season is played for.
 */
export const divisionConcentration = (points: readonly number[]): DivisionConcentration => {
  const sorted = [...points].map((value) => Math.max(0, value)).sort((left, right) => right - left);
  const participants = sorted.length;
  const totalPoints = sorted.reduce((sum, value) => sum + value, 0);
  const applicable = concentrationApplies(participants);
  if (totalPoints === 0) {
    return {
      participants,
      totalPoints,
      topDecileShare: 0,
      topParticipantShare: 0,
      applicable,
      breached: false
    };
  }
  const decileSize = Math.max(1, Math.ceil(participants / 10));
  const decilePoints = sorted.slice(0, decileSize).reduce((sum, value) => sum + value, 0);
  const topDecileShare = decilePoints / totalPoints;
  const topParticipantShare = (sorted[0] ?? 0) / totalPoints;
  return {
    participants,
    totalPoints,
    topDecileShare,
    topParticipantShare,
    applicable,
    breached:
      applicable &&
      (topDecileShare > TERRITORY_CONCENTRATION_LIMITS.topDecileShare ||
        topParticipantShare > TERRITORY_CONCENTRATION_LIMITS.topParticipantShare)
  };
};

/**
 * The consecutive-breach count after today's observation, from yesterday's.
 *
 * A single day above the line is noise; seven in a row is the signal
 * `product.md` acts on. One clean day resets the count, because the rule is
 * about a sustained condition and not a tally of bad days.
 */
export const concentrationBreachRun = (previousDays: number, breachedToday: boolean): number =>
  breachedToday ? Math.max(0, Math.trunc(previousDays)) + 1 : 0;

/**
 * Whether awards analysis should pause: seven consecutive breached days
 * (`product.md`). Pausing analysis is an instruction to people, not an
 * automatic change to anybody's standing — nothing here rescinds points.
 */
export const concentrationPausesAwards = (breachRunDays: number): boolean =>
  breachRunDays >= TERRITORY_CONCENTRATION_LIMITS.sustainedBreachDays;

/**
 * Whether a week's control snapshot may be rolled back to `toVersion`.
 *
 * Rollback repoints the week at an *existing earlier* snapshot; it never edits
 * or deletes one. Rolling forward is not rollback — a newer version is produced
 * by recomputing, which is a different act with a different audit trail — and
 * rolling back to the version already current is a no-op somebody would mistake
 * for having done something.
 */
export const canRollBackTerritoryWeek = (currentVersion: number, toVersion: number): boolean =>
  Number.isInteger(toVersion) && toVersion >= 1 && toVersion < currentVersion;
