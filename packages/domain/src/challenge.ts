import type { ChallengeMode } from '@runsphere/contracts';

/** Re-exported so a scoring caller needs only `@runsphere/domain`. */
export type { ChallengeMode };

/**
 * The published 1v1 challenge rule (`rule_versions.kind = 'challenge'`), in
 * contract camelCase. A challenge is pace-neutral and cosmetic (ADR-0005): the
 * rule may cap per-day contribution and enable modes, and it can never weight
 * pace, speed, distance, or location.
 *
 * `modes` is the authoritative list of *scoreable* modes. A mode stays out of
 * it until the server can actually derive it — `quest_completion` has no
 * completion record to read yet, so scoring it would invent a 0-0 tie.
 */
export interface ChallengeRule {
  dailyCapMinutes: number;
  minMinutesPerActiveDay: number;
  lengthDays: number[];
  modes: ChallengeMode[];
}

const KNOWN_MODES: readonly ChallengeMode[] = ['active_minutes', 'active_days', 'quest_completion'];

/**
 * Validate and normalize an untrusted `rule_versions.definition` payload.
 * Throws on any missing or out-of-range field so a malformed published rule
 * fails loudly instead of silently scoring every challenge as a tie.
 */
export function parseChallengeRule(definition: unknown): ChallengeRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Challenge rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;

  const readInteger = (key: string, minimum: number): number => {
    const value = rule[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
      throw new Error(`Challenge rule field '${key}' must be an integer >= ${minimum}`);
    }
    return value;
  };

  const dailyCapMinutes = readInteger('dailyCapMinutes', 1);
  const minMinutesPerActiveDay = readInteger('minMinutesPerActiveDay', 1);

  if (!Array.isArray(rule.lengthDays) || rule.lengthDays.length === 0) {
    throw new Error("Challenge rule field 'lengthDays' must be a non-empty array");
  }
  const lengthDays = rule.lengthDays.map((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
      throw new Error(`Challenge rule 'lengthDays[${index}]' must be an integer between 1 and 31`);
    }
    return value;
  });

  if (!Array.isArray(rule.modes)) {
    throw new Error("Challenge rule field 'modes' must be an array");
  }
  const modes = rule.modes.map((value, index) => {
    if (typeof value !== 'string' || !KNOWN_MODES.includes(value as ChallengeMode)) {
      throw new Error(`Challenge rule 'modes[${index}]' must be one of ${KNOWN_MODES.join(', ')}`);
    }
    return value as ChallengeMode;
  });

  return { dailyCapMinutes, minMinutesPerActiveDay, lengthDays, modes };
}

export const challengeModeEnabled = (rule: ChallengeRule, mode: ChallengeMode): boolean =>
  rule.modes.includes(mode);

export const challengeLengthEnabled = (rule: ChallengeRule, lengthDays: number): boolean =>
  rule.lengthDays.includes(lengthDays);
