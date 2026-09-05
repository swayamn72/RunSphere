import type { TerritoryStatus } from '@runsphere/contracts';
import { divisionFor, type GlobalBoardDivision } from './global-board.js';

export type { TerritoryStatus };

/**
 * Territory seasons and enrollment (Phase 4, milestone 4.1).
 *
 * **Territory capture is not implemented and remains disabled** until the
 * Territory gate in the release plan passes (ADR-0008). Nothing in this file
 * scores a cell, reads a location, or knows what H3 is: it decides whether a
 * season can be joined, and which division a participant joins in.
 *
 * The division bands are the same shape the global board publishes and are read
 * by the same matcher, because they answer the same question — how long has
 * this account been active — and answering it two ways would eventually mean
 * answering it differently.
 */

export interface TerritoryRule {
  divisions: GlobalBoardDivision[];
}

/** Throws on a malformed published rule rather than assigning a wrong band. */
export function parseTerritoryRule(definition: unknown): TerritoryRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Territory rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;
  if (!Array.isArray(rule.divisions) || rule.divisions.length === 0) {
    throw new Error("Territory rule field 'divisions' must be a non-empty array");
  }
  let previousBand = -1;
  const divisions = rule.divisions.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Territory rule 'divisions[${index}]' must be an object`);
    }
    const division = value as Record<string, unknown>;
    if (typeof division.key !== 'string' || !division.key || division.key.length > 64) {
      throw new Error(`Territory rule 'divisions[${index}].key' must be a short string`);
    }
    const last = index === (rule.divisions as unknown[]).length - 1;
    if (division.maxPriorActiveWeeks === undefined) {
      if (!last)
        throw new Error(
          `Territory rule 'divisions[${index}]' may omit 'maxPriorActiveWeeks' only if it is last`
        );
      return { key: division.key };
    }
    if (last) throw new Error("Territory rule's last division must omit 'maxPriorActiveWeeks'");
    const band = division.maxPriorActiveWeeks;
    if (typeof band !== 'number' || !Number.isInteger(band) || band < 0) {
      throw new Error(
        `Territory rule 'divisions[${index}].maxPriorActiveWeeks' must be a whole number of weeks`
      );
    }
    if (band <= previousBand) {
      throw new Error("Territory rule 'divisions' must have ascending maxPriorActiveWeeks");
    }
    previousBand = band;
    return { key: division.key, maxPriorActiveWeeks: band };
  });
  return { divisions };
}

/**
 * The division an account enrols into, from how many earlier weeks it was
 * active. Assigned once and stored: `product.md` permits rebalancing between
 * seasons only, so nothing — not later activity, not leaving and re-joining —
 * moves somebody mid-season.
 */
export const territoryDivisionFor = (priorActiveWeeks: number, rule: TerritoryRule): string =>
  divisionFor(priorActiveWeeks, rule);

/**
 * A season accepts enrolment while it is open and while it is running.
 *
 * Joining a season already in progress is allowed for the same reason a
 * competition can be entered late: the alternative is a product that punishes
 * somebody for hearing about it on Tuesday. An announced season is not yet
 * joinable — it has been described, not started — and an ended one never is.
 */
export const territoryEnrollmentOpen = (status: TerritoryStatus): boolean =>
  status === 'open' || status === 'live';

/**
 * Division size targets from `product.md`: 100–250 enrolled participants, merge
 * below 40, split above 300, **at season start only**.
 *
 * These are recorded here because the numbers belong with the rules rather than
 * in a document nobody reads at the right moment. Nothing acts on them:
 * merging and splitting are between-season operations, and doing either
 * automatically mid-season would be exactly the rebalancing `product.md`
 * forbids.
 */
export const DIVISION_SIZE_TARGET = { minimum: 100, maximum: 250, mergeBelow: 40, splitAbove: 300 };

export type DivisionSizeAdvice = 'merge' | 'split' | 'healthy';

/**
 * What a division's size suggests should happen **at the next season start**.
 * Advice for a human planning the next season, never an action.
 */
export const divisionSizeAdvice = (enrolledCount: number): DivisionSizeAdvice => {
  if (enrolledCount < DIVISION_SIZE_TARGET.mergeBelow) return 'merge';
  if (enrolledCount > DIVISION_SIZE_TARGET.splitAbove) return 'split';
  return 'healthy';
};

/**
 * Whether territory capture is available. It is not, and this is the single
 * place that says so: the API, the console, and the app all read this rather
 * than each carrying its own claim about a feature none of them implement.
 *
 * It becomes a real check when the Territory gate passes and the engine lands.
 */
export const TERRITORY_CAPTURE_ENABLED = false;

export const TERRITORY_CAPTURE_NOTE =
  'Territory capture is not switched on. A season records who is taking part and in which division; no cell is claimed, no location is read, and no rank is calculated.';
