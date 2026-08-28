import {
  cappedWeeklyActiveMinutes,
  kolkataDate,
  weeklyActiveDayCount,
  weeklyPeriodStart,
  type ScoredActivity
} from './gamification.js';

/** The published XP-earning rule, in contract camelCase (ADR-0005, ADR-0006). */
export interface ProgressionRule {
  xpPerActiveMinute: number;
  xpPerActiveDay: number;
  dailyCapMinutes: number;
  minMinutesPerActiveDay: number;
  goalActiveDays: number;
  levels: number[];
}

/**
 * Validate and normalize an untrusted `rule_versions.definition` payload into a
 * `ProgressionRule`. Throws on any missing or out-of-range field so a malformed
 * published rule fails loudly rather than silently zeroing everyone's XP.
 */
export function parseProgressionRule(definition: unknown): ProgressionRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Progression rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;

  const readInteger = (key: string, minimum: number): number => {
    const value = rule[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
      throw new Error(`Progression rule field '${key}' must be an integer >= ${minimum}`);
    }
    return value;
  };

  const xpPerActiveMinute = readInteger('xpPerActiveMinute', 0);
  const xpPerActiveDay = readInteger('xpPerActiveDay', 0);
  const dailyCapMinutes = readInteger('dailyCapMinutes', 1);
  const minMinutesPerActiveDay = readInteger('minMinutesPerActiveDay', 1);
  const goalActiveDays = readInteger('goalActiveDays', 1);
  if (goalActiveDays > 7) {
    throw new Error("Progression rule field 'goalActiveDays' must be between 1 and 7");
  }

  if (!Array.isArray(rule.levels) || rule.levels.length === 0) {
    throw new Error("Progression rule field 'levels' must be a non-empty array");
  }
  const levels = rule.levels.map((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`Progression rule 'levels[${index}]' must be an integer >= 0`);
    }
    return value;
  });

  return {
    xpPerActiveMinute,
    xpPerActiveDay,
    dailyCapMinutes,
    minMinutesPerActiveDay,
    goalActiveDays,
    levels
  };
}

/** The activity-derived XP sources the weekly snapshots persist. */
export type ActivityXpSource = 'active_minutes' | 'active_day_consistency';

/**
 * One finalized XP grant for a closed week. `dedupeKey` makes persistence
 * idempotent per (account, week); it is deliberately independent of the rule
 * version so a week is only ever scored once (ADR-0006 immutable snapshots).
 */
export interface XpGrant {
  source: ActivityXpSource;
  amount: number;
  /** Asia/Kolkata Monday `YYYY-MM-DD` of the week being scored. */
  periodStart: string;
  dedupeKey: string;
}

/**
 * Finalize the weekly XP grant pair (minutes + active days) for a single week
 * beginning at `weekStart`. Grants with a zero amount are omitted so nothing is
 * persisted when a week contributed no XP.
 */
export function weeklyXpGrants(
  activities: readonly ScoredActivity[],
  rule: ProgressionRule,
  weekStart: Date
): XpGrant[] {
  const cappedMinutes = cappedWeeklyActiveMinutes(activities, weekStart, rule.dailyCapMinutes);
  const activeDays = weeklyActiveDayCount(activities, weekStart, rule.minMinutesPerActiveDay);
  const periodStart = kolkataDate(weekStart);
  const grants: XpGrant[] = [];

  const minutesAmount = cappedMinutes * rule.xpPerActiveMinute;
  if (minutesAmount > 0) {
    grants.push({
      source: 'active_minutes',
      amount: minutesAmount,
      periodStart,
      dedupeKey: `active_minutes:${periodStart}`
    });
  }

  const daysAmount = activeDays * rule.xpPerActiveDay;
  if (daysAmount > 0) {
    grants.push({
      source: 'active_day_consistency',
      amount: daysAmount,
      periodStart,
      dedupeKey: `active_day_consistency:${periodStart}`
    });
  }

  return grants;
}

/** Cosmetic level summary derived from total XP against cumulative thresholds. */
export interface LevelInfo {
  level: number;
  xpInLevel: number;
  nextLevelAt?: number;
}

/**
 * Map a lifetime XP total to a cosmetic level using cumulative thresholds
 * (`levels[i]` is the XP required to reach level `i + 1`). A total below the
 * lowest threshold still resolves to level 1 with zero in-level XP, and totals
 * beyond the final threshold stay at the terminal level without a `nextLevelAt`.
 */
export function xpLevel(totalXp: number, levels: readonly number[]): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  for (let index = 0; index < levels.length; index += 1) {
    if (levels[index]! <= xp) level = index + 1;
  }
  const currentThreshold = levels[level - 1] ?? 0;
  const nextThreshold = level < levels.length ? levels[level] : undefined;
  return {
    level,
    xpInLevel: xp - currentThreshold,
    ...(nextThreshold !== undefined ? { nextLevelAt: nextThreshold } : {})
  };
}

/** The Asia/Kolkata Monday week start containing the current instant. */
export const currentWeekStart = (now: Date = new Date()): Date => weeklyPeriodStart(now);
