/**
 * Global board rules (Phase 3, milestone 3.5).
 *
 * The global board is the widest audience in the product, so every decision
 * about who appears on it and where lives here, as pure functions over a
 * published rule (`rule_versions.kind = 'global_board'`). Nothing in this file
 * reads pace, distance, or location: a score is capped validated active
 * minutes and a division is a band of *how long someone has been active*,
 * never how fast or how far (ADR-0005, ADR-0007).
 */

/**
 * One published cohort band. `maxPriorActiveWeeks` is inclusive, and exactly
 * one division — the last — omits it and catches everybody above the bands.
 */
export interface GlobalBoardDivision {
  key: string;
  maxPriorActiveWeeks?: number;
}

export interface GlobalBoardRule {
  dailyCapMinutes: number;
  /** How many entries one page of a division shows. */
  pageSize: number;
  /**
   * The score an account needs before it is ranked at all. A board of names
   * against zero would publish participation without publishing anything
   * worth reading, so an account that did not move this period simply is not
   * on it.
   */
  minScore: number;
  divisions: GlobalBoardDivision[];
}

const readInteger = (
  rule: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number => {
  const value = rule[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Global board rule field '${key}' must be an integer between ${minimum} and ${maximum}`
    );
  }
  return value;
};

/**
 * Validate and normalize an untrusted published definition. Throws on any
 * malformed field, so a bad rule stops the board being computed rather than
 * silently ranking everybody into one anonymous bucket.
 */
export function parseGlobalBoardRule(definition: unknown): GlobalBoardRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Global board rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;
  const dailyCapMinutes = readInteger(rule, 'dailyCapMinutes', 1, 1440);
  const pageSize = readInteger(rule, 'pageSize', 1, 200);
  const minScore = readInteger(rule, 'minScore', 1, 100_000);

  if (!Array.isArray(rule.divisions) || rule.divisions.length === 0) {
    throw new Error("Global board rule field 'divisions' must be a non-empty array");
  }
  let previousBand = -1;
  const divisions = rule.divisions.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Global board rule 'divisions[${index}]' must be an object`);
    }
    const division = value as Record<string, unknown>;
    if (typeof division.key !== 'string' || division.key.length === 0 || division.key.length > 32) {
      throw new Error(`Global board rule 'divisions[${index}].key' must be a short string`);
    }
    const last = index === (rule.divisions as unknown[]).length - 1;
    if (division.maxPriorActiveWeeks === undefined) {
      // The open-ended band catches everyone above the last threshold, and a
      // band after it could never be reached.
      if (!last)
        throw new Error(
          `Global board rule 'divisions[${index}]' may omit 'maxPriorActiveWeeks' only if it is last`
        );
      return { key: division.key };
    }
    if (last) {
      throw new Error("Global board rule's last division must omit 'maxPriorActiveWeeks'");
    }
    const band = division.maxPriorActiveWeeks;
    if (typeof band !== 'number' || !Number.isInteger(band) || band < 0) {
      throw new Error(
        `Global board rule 'divisions[${index}].maxPriorActiveWeeks' must be a whole number of weeks`
      );
    }
    // Ascending bands, so the first match is always the narrowest one.
    if (band <= previousBand) {
      throw new Error("Global board rule 'divisions' must have ascending maxPriorActiveWeeks");
    }
    previousBand = band;
    return { key: division.key, maxPriorActiveWeeks: band };
  });

  return { dailyCapMinutes, pageSize, minScore, divisions };
}

/**
 * The division an account is in for one period, from how many earlier weeks it
 * was active. Derived per period rather than carried, so nobody is stuck in a
 * band they have grown out of, and never derived from a score: a division
 * decides who you are ranked *with*, not how well you did.
 */
export const divisionFor = (
  priorActiveWeeks: number,
  // Any published rule that carries bands: the global board and the territory
  // season both answer "how long has this account been active", and answering
  // it in two places would eventually mean answering it differently.
  rule: { divisions: readonly GlobalBoardDivision[] }
): string => {
  const weeks = Math.max(0, Math.trunc(priorActiveWeeks));
  const band = rule.divisions.find(
    (division) =>
      division.maxPriorActiveWeeks !== undefined && weeks <= division.maxPriorActiveWeeks
  );
  // The last division has no ceiling, so this is always defined for a rule
  // that parsed.
  return (band ?? rule.divisions[rule.divisions.length - 1]!).key;
};

/** Whether a score earns a place on the board at all. */
export const rankedOnGlobalBoard = (score: number, rule: GlobalBoardRule): boolean =>
  score >= rule.minScore;
