import { kolkataDate } from './gamification.js';

/**
 * Territory traversal and control (Phase 4, milestone 4.2; ADR-0001, ADR-0008).
 *
 * This is the arithmetic of a territory season, written as pure functions so
 * the rules can be read and argued with before anything runs. **It is not
 * switched on**: `TERRITORY_CAPTURE_ENABLED` is false, and the worker refuses
 * to score without the two inputs described below.
 *
 * Two dependencies are injected rather than imported, because neither exists
 * in this deployment yet and pretending otherwise would be the whole problem:
 *
 * - **`CellIndexer`** turns a point into an H3 cell. ADR-0001 requires the H3
 *   library, resolution, and algorithm versions to be pinned and stored with
 *   every contribution, so the indexer carries its own version rather than the
 *   engine assuming one.
 * - **`EligibilitySource`** answers whether a cell is eligible public space.
 *   There is no such dataset here. Scoring every traversed cell instead would
 *   mean recording where people live and work, which is exactly what
 *   public-space eligibility exists to prevent — so no source means no
 *   scoring, and the worker says so.
 *
 * Nothing in this file reads pace, speed, or distance. A cell counts once or
 * not at all, so moving faster cannot sweep more of them.
 */

/** One validated trace point. Timestamps are needed for the daily window. */
export interface TracePoint {
  latitude: number;
  longitude: number;
  at: Date;
}

/**
 * The published territory scoring rule (`rule_versions.kind = 'territory'`,
 * from the version pinned on the season).
 */
export interface TerritoryScoringRule {
  /** ADR-0008: the best *contiguous* window of a local day. 60 in v1. */
  bestWindowMinutes: number;
  /** The most eligible cells one participant may contribute in a local day. */
  dailyEligibleCellCap: number;
  /**
   * The most control-days one participant may bank per week, so a season
   * ladder cannot be won by covering ground faster (ADR-0008).
   */
  weeklyControlDayCap: number;
}

export function parseTerritoryScoringRule(definition: unknown): TerritoryScoringRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Territory scoring rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;
  const readInteger = (key: string, minimum: number, maximum: number): number => {
    const value = rule[key];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(
        `Territory scoring rule field '${key}' must be an integer between ${minimum} and ${maximum}`
      );
    }
    return value;
  };
  return {
    bestWindowMinutes: readInteger('bestWindowMinutes', 1, 1440),
    dailyEligibleCellCap: readInteger('dailyEligibleCellCap', 1, 10_000),
    weeklyControlDayCap: readInteger('weeklyControlDayCap', 1, 10_000)
  };
}

/**
 * H3 indexing, injected. The version travels with it so a contribution records
 * what produced it and a season can be recomputed under the same library
 * (ADR-0001).
 */
export interface CellIndexer {
  resolution: number;
  h3Version: string;
  algorithmVersion: string;
  cellFor(point: TracePoint): string;
}

/**
 * Public-space eligibility, injected. No implementation exists yet; when one
 * does, its version is recorded with every contribution so a season stays
 * reproducible after the dataset changes.
 */
export interface EligibilitySource {
  version: string;
  isEligible(cell: string): boolean;
}

export interface DailyWindow {
  /** First point in the chosen window. */
  startsAt: Date;
  /** Distinct eligible cells traversed inside it, in the order first entered. */
  cells: string[];
}

/**
 * The best contiguous window of one local day: the one covering the most
 * distinct eligible cells, ties broken by the earliest start (ADR-0008).
 *
 * Every point is a candidate start, which is what "contiguous" means here — a
 * window is a span of wall-clock time, not a selection of favourable points.
 * Counting *distinct cells* rather than points is what makes the measure
 * pace-neutral: standing still in one cell for an hour scores it once, and so
 * does sprinting through it.
 */
export const bestContiguousWindow = (
  points: readonly TracePoint[],
  rule: TerritoryScoringRule,
  indexer: CellIndexer,
  eligibility: EligibilitySource
): DailyWindow | undefined => {
  const ordered = [...points].sort((left, right) => left.at.getTime() - right.at.getTime());
  const windowMillis = rule.bestWindowMinutes * 60_000;
  let best: DailyWindow | undefined;

  for (let start = 0; start < ordered.length; start += 1) {
    const opensAt = ordered[start]!.at.getTime();
    const cells: string[] = [];
    const seen = new Set<string>();
    for (let index = start; index < ordered.length; index += 1) {
      const point = ordered[index]!;
      if (point.at.getTime() - opensAt >= windowMillis) break;
      const cell = indexer.cellFor(point);
      if (seen.has(cell) || !eligibility.isEligible(cell)) continue;
      seen.add(cell);
      cells.push(cell);
    }
    // Strictly greater keeps the earliest start on a tie, because `ordered`
    // is ascending and the first window to reach a count is the earliest one.
    if (cells.length && (!best || cells.length > best.cells.length)) {
      best = { startsAt: ordered[start]!.at, cells };
    }
  }
  return best;
};

export interface DailyContribution {
  localDate: string;
  cells: string[];
}

/**
 * One local day's accepted contribution: the best window's cells, truncated to
 * the published daily cap.
 *
 * The cap is applied in the order cells were first entered, so it is
 * deterministic and does not quietly prefer whichever cells happen to be worth
 * more — no cell is worth more than another (ADR-0001).
 */
export const dailyContribution = (
  points: readonly TracePoint[],
  rule: TerritoryScoringRule,
  indexer: CellIndexer,
  eligibility: EligibilitySource
): DailyContribution | undefined => {
  if (!points.length) return undefined;
  const window = bestContiguousWindow(points, rule, indexer, eligibility);
  if (!window) return undefined;
  return {
    localDate: kolkataDate(window.startsAt),
    cells: window.cells.slice(0, rule.dailyEligibleCellCap)
  };
};

/** One stored contribution, as the control resolver reads it back. */
export interface AcceptedContribution {
  cellIndex: string;
  localDate: string;
  /** Opaque and stable; never a display identity, and never shown on a map. */
  participantRef: string;
  /** When the contribution was accepted, for the documented tie-break. */
  acceptedAt: Date;
}

export interface CellControl {
  cellIndex: string;
  participantRef: string;
  /** Days this participant contributed to the cell in the week. */
  days: number;
}

/**
 * Who controls each cell for one week.
 *
 * The winner is whoever contributed on the most distinct local days — days,
 * not visits and not cells, so a participant cannot take a cell by passing
 * through it repeatedly in one afternoon. Ties go to the earliest accepted
 * contribution, and only then to the opaque participant reference, which is
 * documented as a reproducibility fallback rather than a fair tiebreak
 * (ADR-0008).
 *
 * Upload or worker order never decides control: the input is the *final*
 * accepted set, and the comparison never looks at insertion order.
 */
export const resolveCellControl = (
  contributions: readonly AcceptedContribution[]
): CellControl[] => {
  const byCell = new Map<string, Map<string, { days: Set<string>; earliest: Date }>>();
  for (const contribution of contributions) {
    const participants = byCell.get(contribution.cellIndex) ?? new Map();
    const entry = participants.get(contribution.participantRef) ?? {
      days: new Set<string>(),
      earliest: contribution.acceptedAt
    };
    entry.days.add(contribution.localDate);
    if (contribution.acceptedAt < entry.earliest) entry.earliest = contribution.acceptedAt;
    participants.set(contribution.participantRef, entry);
    byCell.set(contribution.cellIndex, participants);
  }

  const controls: CellControl[] = [];
  for (const [cellIndex, participants] of byCell) {
    let winner: { ref: string; days: number; earliest: Date } | undefined;
    for (const [ref, entry] of participants) {
      const candidate = { ref, days: entry.days.size, earliest: entry.earliest };
      if (!winner) {
        winner = candidate;
        continue;
      }
      if (candidate.days !== winner.days) {
        if (candidate.days > winner.days) winner = candidate;
        continue;
      }
      if (candidate.earliest.getTime() !== winner.earliest.getTime()) {
        if (candidate.earliest < winner.earliest) winner = candidate;
        continue;
      }
      // Reproducibility fallback only: two participants with the same day count
      // and the same accepted instant is a coin toss, and a stable coin toss is
      // the most that can be promised.
      if (candidate.ref < winner.ref) winner = candidate;
    }
    if (winner) controls.push({ cellIndex, participantRef: winner.ref, days: winner.days });
  }
  return controls.sort((left, right) => left.cellIndex.localeCompare(right.cellIndex));
};

/**
 * Season ladder points for one week: control-days, capped.
 *
 * ADR-0008 says the ladder uses "capped control-days rather than uncapped cell
 * volume", so a week's points are the control-days earned that week, held to
 * the published weekly cap. The cap is what stops a season being won by
 * covering more ground per hour.
 *
 * **This is an interpretation of an under-specified rule.** ADR-0008 does not
 * define the cap's period or say whether it applies per cell or per
 * participant; this reads it as per participant per week, which is the reading
 * that makes the cap do the job the ADR gives it. It needs confirming before a
 * season runs for real.
 */
export const weeklyLadderPoints = (
  controls: readonly CellControl[],
  participantRef: string,
  rule: TerritoryScoringRule
): number => {
  const earned = controls
    .filter((control) => control.participantRef === participantRef)
    .reduce((total, control) => total + control.days, 0);
  return Math.min(earned, rule.weeklyControlDayCap);
};
