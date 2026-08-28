import {
  dailyValidatedActiveMinutes,
  weeklyActiveDayCount,
  weeklyPeriodStart,
  type ScoredActivity
} from './gamification.js';

/**
 * Pace-neutral achievement conditions (ADR-0005). Every condition reads only
 * server-derived, capped, non-pace metrics: completed activities, active days,
 * lifetime capped minutes, and cosmetic level. No condition ever reads pace,
 * distance, calories, heart rate, route, or location.
 */
export type AchievementCondition =
  | { readonly kind: 'completed_activities'; readonly min: number }
  | { readonly kind: 'weekly_active_days'; readonly min: number }
  | { readonly kind: 'lifetime_capped_minutes'; readonly min: number }
  | { readonly kind: 'level'; readonly min: number };

/** A published achievement definition, in contract camelCase. */
export interface AchievementRule {
  key: string;
  title: string;
  description: string;
  condition: AchievementCondition;
  rewardXp: number;
}

const readString = (rule: Record<string, unknown>, key: string, maxLength: number): string => {
  const value = rule[key];
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new Error(`Achievement rule field '${key}' must be a string of length 1..${maxLength}`);
  }
  return value;
};

const readInteger = (value: unknown, key: string, minimum: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`Achievement rule field '${key}' must be an integer >= ${minimum}`);
  }
  return value;
};

/**
 * Validate an untrusted achievement condition payload. Throws on unknown kinds
 * or out-of-range thresholds so a malformed published definition fails loudly.
 */
export function parseAchievementCondition(value: unknown): AchievementCondition {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Achievement condition must be a JSON object');
  }
  const condition = value as Record<string, unknown>;
  const kind = condition.kind;
  if (typeof kind !== 'string') {
    throw new Error("Achievement condition field 'kind' is required");
  }
  switch (kind) {
    case 'weekly_active_days': {
      const min = readInteger(condition.min, 'min', 1);
      if (min > 7) {
        throw new Error("Achievement condition 'weekly_active_days.min' must be between 1 and 7");
      }
      return { kind, min };
    }
    case 'completed_activities':
    case 'lifetime_capped_minutes':
    case 'level':
      return { kind, min: readInteger(condition.min, 'min', 1) };
    default:
      throw new Error(`Unknown achievement condition kind '${String(kind)}'`);
  }
}

/**
 * Validate and normalize an untrusted achievement definition payload into an
 * `AchievementRule`.
 */
export function parseAchievementRule(definition: unknown): AchievementRule {
  if (typeof definition !== 'object' || definition === null) {
    throw new Error('Achievement rule must be a JSON object');
  }
  const rule = definition as Record<string, unknown>;
  return {
    key: readString(rule, 'key', 80),
    title: readString(rule, 'title', 120),
    description:
      typeof rule.description === 'string' && rule.description.length <= 500
        ? rule.description
        : (() => {
            throw new Error(
              "Achievement rule field 'description' must be a string of length <= 500"
            );
          })(),
    condition: parseAchievementCondition(rule.condition),
    rewardXp: readInteger(rule.rewardXp, 'rewardXp', 0)
  };
}

/** Number of validated activity records (all activities passed in are server-derived). */
export const completedActivityCount = (activities: readonly ScoredActivity[]): number =>
  activities.length;

/**
 * Lifetime sum of validated active minutes, capped per local day. Uses the same
 * whole-minute daily flooring as the weekly evaluators, then applies the cap per
 * distinct Asia/Kolkata day across the entire history.
 */
export function lifetimeCappedActiveMinutes(
  activities: readonly ScoredActivity[],
  dailyCapMinutes: number
): number {
  const daily = dailyValidatedActiveMinutes(activities);
  const cap = Math.max(0, dailyCapMinutes);
  let total = 0;
  for (const minutes of daily.values()) {
    total += Math.min(minutes, cap);
  }
  return total;
}

/**
 * The highest active-day count across any single week in the activity history.
 * Week boundaries are Asia/Kolkata Monday (ADR-0006); weeks are recomputed from
 * the immutable activity set, so resets never lose history.
 */
export function bestWeeklyActiveDayCount(
  activities: readonly ScoredActivity[],
  minMinutesPerActiveDay = 1
): number {
  const weekStarts = new Set<number>();
  for (const activity of activities) {
    const endedAt =
      typeof activity.endedAt === 'string' ? new Date(activity.endedAt) : activity.endedAt;
    weekStarts.add(weeklyPeriodStart(endedAt).getTime());
  }
  let best = 0;
  for (const startMs of weekStarts) {
    const days = weeklyActiveDayCount(activities, new Date(startMs), minMinutesPerActiveDay);
    if (days > best) best = days;
  }
  return best;
}

/** Metrics an achievement condition is allowed to read. */
export interface AchievementMetrics {
  completedActivities: number;
  lifetimeCappedMinutes: number;
  bestWeeklyActiveDays: number;
  totalXp: number;
  level: number;
}

/** Inputs for a single idempotent evaluation pass. */
export interface AchievementEvaluationInput {
  activities: readonly ScoredActivity[];
  dailyCapMinutes: number;
  minMinutesPerActiveDay: number;
  totalXp: number;
  level: number;
}

/** Compute the metrics for `input` from the activity history plus progression totals. */
export function metricsFor(input: AchievementEvaluationInput): AchievementMetrics {
  return {
    completedActivities: completedActivityCount(input.activities),
    lifetimeCappedMinutes: lifetimeCappedActiveMinutes(input.activities, input.dailyCapMinutes),
    bestWeeklyActiveDays: bestWeeklyActiveDayCount(input.activities, input.minMinutesPerActiveDay),
    totalXp: input.totalXp,
    level: input.level
  };
}

const satisfied = (condition: AchievementCondition, metrics: AchievementMetrics): boolean => {
  switch (condition.kind) {
    case 'completed_activities':
      return metrics.completedActivities >= condition.min;
    case 'weekly_active_days':
      return metrics.bestWeeklyActiveDays >= condition.min;
    case 'lifetime_capped_minutes':
      return metrics.lifetimeCappedMinutes >= condition.min;
    case 'level':
      return metrics.level >= condition.min;
  }
};

/** Return the subset of published rules whose condition is satisfied right now. */
export function evaluateAchievements(
  input: AchievementEvaluationInput,
  rules: readonly AchievementRule[]
): AchievementRule[] {
  const metrics = metricsFor(input);
  return rules.filter((rule) => satisfied(rule.condition, metrics));
}
