import { kolkataDate } from './gamification.js';
import { seasonMonthFor } from './territory-claim.js';

/**
 * Turf's monthly season: ranks, the reset, and the hall of fame
 * (`territory-guide.md`, pending-work 2.5-2.8).
 *
 * A Turf season is one Asia/Kolkata month. At 00:01 IST on the 1st every claim
 * expires, the map clears, and everybody starts level. This file holds the
 * rules that decide *what a season was* — the standings, the records it broke,
 * and whether it is over — and none of the SQL that reads or writes them.
 *
 * **Why a month and not a week.** ADR-0008 gave the cell engine weekly resets
 * because a cell is scored by how many days you visited it, so a week is the
 * shortest window that can hold a pattern. Turf is scored by a single run, so a
 * week would mean a map that never settles: one good Saturday would decide it.
 * A month is long enough for ground to change hands several times and short
 * enough that a runner who joins in week three is not playing for nothing.
 *
 * Nothing here deletes anything. An expired claim is archived, not removed, and
 * the whole history stays readable (`territory-guide.md`).
 */

/** Ground held by one account at one moment, before it is ranked. */
export interface TurfHolding {
  accountId: string;
  totalAreaSqm: number;
  claimCount: number;
  /** Largest single claim they hold, for the hall of fame. */
  largestClaimSqm: number;
  /** Days their longest-standing current claim has been held. */
  longestHeldDays: number;
}

/** One row of a season standing. */
export interface TurfStanding extends TurfHolding {
  rank: number;
}

/**
 * Rank ground held, most first.
 *
 * Ties share a rank and the next rank skips, which is how every other board in
 * this product reads and how people expect a leaderboard to behave: two runners
 * on 30,000 m² are both second, and the next one is fourth. The tie-break for
 * *ordering* within a shared rank is the account id — not because it means
 * anything, but because two equal rows must come back in the same order every
 * time or a snapshot taken twice would disagree with itself.
 */
export const turfStandings = (holdings: readonly TurfHolding[]): TurfStanding[] => {
  const ordered = [...holdings]
    .filter((holding) => holding.totalAreaSqm > 0)
    .sort(
      (left, right) =>
        right.totalAreaSqm - left.totalAreaSqm || left.accountId.localeCompare(right.accountId)
    );

  const standings: TurfStanding[] = [];
  let rank = 0;
  let previousArea: number | undefined;
  for (const [index, holding] of ordered.entries()) {
    if (previousArea === undefined || holding.totalAreaSqm !== previousArea) rank = index + 1;
    previousArea = holding.totalAreaSqm;
    standings.push({ ...holding, rank });
  }
  return standings;
};

/**
 * Peak ground held, which is what a season is remembered by.
 *
 * A final standing measures the last moment of the month, and the last moment
 * is a poor summary of a mechanic where ground is taken back and forth: a
 * runner who held 90,000 m² for three weeks and lost most of it on the 30th had
 * a better season than the total says. `peak` is the largest figure any
 * snapshot recorded, so the weekly job is what makes it meaningful — a season
 * with no weekly snapshots has a peak equal to its final total, which is
 * correct and simply less interesting.
 */
export const peakAreaSqm = (finalAreaSqm: number, snapshotAreas: readonly number[]): number =>
  Math.max(finalAreaSqm, 0, ...snapshotAreas);

/** The records the hall of fame keeps. Both are areas, so both are m². */
export type HallOfFameRecord = 'largest_holding' | 'largest_claim';

export interface HallOfFameCandidate {
  recordType: HallOfFameRecord;
  accountId: string;
  valueSqm: number;
}

/**
 * The records a season's standings would set, if they beat what stands.
 *
 * `largest_holding` is the most ground one person held at once; `largest_claim`
 * is the single biggest loop anybody kept. Returned as candidates rather than
 * written, because whether a candidate is a record depends on the current
 * holder, and that is a read the caller already has to do.
 */
export const hallOfFameCandidates = (standings: readonly TurfStanding[]): HallOfFameCandidate[] => {
  const candidates: HallOfFameCandidate[] = [];
  const byHolding = standings.reduce<TurfStanding | undefined>(
    (best, standing) => (!best || standing.totalAreaSqm > best.totalAreaSqm ? standing : best),
    undefined
  );
  if (byHolding && byHolding.totalAreaSqm > 0) {
    candidates.push({
      recordType: 'largest_holding',
      accountId: byHolding.accountId,
      valueSqm: byHolding.totalAreaSqm
    });
  }
  const byClaim = standings.reduce<TurfStanding | undefined>(
    (best, standing) =>
      !best || standing.largestClaimSqm > best.largestClaimSqm ? standing : best,
    undefined
  );
  if (byClaim && byClaim.largestClaimSqm > 0) {
    candidates.push({
      recordType: 'largest_claim',
      accountId: byClaim.accountId,
      valueSqm: byClaim.largestClaimSqm
    });
  }
  return candidates;
};

/** Beats the standing record, or there is no standing record. A tie does not. */
export const beatsRecord = (candidateSqm: number, standingSqm: number | undefined): boolean =>
  standingSqm === undefined || candidateSqm > standingSqm;

/** The month before this one, as `YYYY-MM`. Rolls the year over. */
export const previousSeasonMonth = (seasonMonth: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(seasonMonth);
  if (!match) throw new Error(`Expected a YYYY-MM season month, received '${seasonMonth}'`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/**
 * Seasons that have ended and not yet been reset, oldest first.
 *
 * The reset is driven by state rather than by a clock: the job asks "is there an
 * open season that is not the current month" on every sweep. That makes it
 * idempotent, which the plan requires, and self-healing — a worker that was
 * down at 00:01 on the 1st resets the moment it comes back, rather than the
 * month silently never ending. It also means a deployment that was off for two
 * months closes both, in order.
 */
export const seasonsDueForReset = (openSeasons: readonly string[], now: Date): string[] => {
  const current = seasonMonthFor(now);
  return [...openSeasons].filter((month) => month < current).sort();
};

/** Whether a season month is the one currently being played. */
export const isCurrentSeason = (seasonMonth: string, now: Date): boolean =>
  seasonMonthFor(now) === seasonMonth;

/**
 * The Asia/Kolkata Monday a weekly rank snapshot belongs to, as `YYYY-MM-DD`.
 *
 * Weekly snapshots are the same Monday-based Kolkata week every other period in
 * this product uses (ADR-0006), so a Turf week and a challenge week are the
 * same seven days and a runner is never being measured against two calendars.
 */
export const rankWeekStart = (now: Date): string => {
  const date = kolkataDate(now);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utcDayIndex = Date.UTC(year, month - 1, day) / 86_400_000;
  // 1970-01-01 was a Thursday; 0 = Sunday.
  const weekday = (((utcDayIndex + 4) % 7) + 7) % 7;
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  return monday.toISOString().slice(0, 10);
};

/** Days a claim has been held, floored. Used for the season recap card. */
export const heldDays = (claimedAt: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - claimedAt.getTime()) / 86_400_000));

/**
 * What a runner is told when their season ends.
 *
 * No comparison to anybody else beyond the rank they already earned, and no
 * exhortation: a season summary that tells somebody to try harder next month is
 * a season summary nobody reads twice. Location is a city name the boards
 * already publish, never a coordinate (`screens.md` push catalogue).
 */
/**
 * When the season closes: 00:01 IST on the 1st of the next month
 * (`territory-guide.md`).
 *
 * Kolkata is a fixed UTC+05:30 with no daylight saving (`gamification.ts`), so
 * this is arithmetic rather than a timezone library call.
 */
export const seasonEndsAt = (now: Date): Date => {
  const [year, month] = seasonMonthFor(now).split('-').map(Number) as [number, number];
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1, 0, 1) - 5.5 * 3_600_000);
};

/** Whole days left in the season, rounded up, never negative. */
export const daysUntilSeasonEnd = (now: Date): number =>
  Math.max(0, Math.ceil((seasonEndsAt(now).getTime() - now.getTime()) / 86_400_000));

/** `screens.md`: the warning goes out three days before the reset. */
export const SEASON_ENDING_WARNING_DAYS = 3;

export const isSeasonEndingSoon = (now: Date): boolean =>
  daysUntilSeasonEnd(now) > 0 && daysUntilSeasonEnd(now) <= SEASON_ENDING_WARNING_DAYS;

export const seasonEndedMessage = (summary: {
  seasonMonth: string;
  rank: number;
  peakAreaSqm: number;
  cityTag?: string;
}): string => {
  const where = summary.cityTag ? ` in ${summary.cityTag}` : '';
  const area = Math.round(summary.peakAreaSqm).toLocaleString('en-IN');
  return `Season ended. Final rank: #${summary.rank}${where}. Peak: ${area} m². New season starts now.`;
};

/** What a runner is told on a Monday. Same rules as above. */
export const weeklyRankMessage = (summary: {
  rank: number;
  totalAreaSqm: number;
  cityTag?: string;
}): string => {
  const where = summary.cityTag ? ` in ${summary.cityTag}` : '';
  const area = Math.round(summary.totalAreaSqm).toLocaleString('en-IN');
  return `Week summary: Rank #${summary.rank}${where} · ${area} m² held.`;
};
