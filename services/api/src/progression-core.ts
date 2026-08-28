import type { Database } from '@runsphere/db';
import type { ProgressionRule, WeeklyConsistency } from '@runsphere/contracts';
import {
  MILLIS_PER_DAY,
  kolkataDate,
  parseProgressionRule,
  weeklyConsistency,
  weeklyPeriodStart,
  weeklyXpGrants,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Shared progression bookkeeping shared by the progression and achievement
 * routes so XP accounting (persisted + live projection) has a single source of
 * truth. All scoring reads server-derived activity only; `processed_at` is the
 * authoritative end instant (ADR-0006).
 */
export interface ActiveProgressionRule {
  version: number;
  rule: ProgressionRule;
}

interface RuleRow {
  version: number;
  definition: unknown;
}

interface ActivityRow {
  active_duration_seconds: number;
  processed_at: Date;
}

export const loadActiveProgressionRule = async (
  database: Database
): Promise<ActiveProgressionRule | undefined> => {
  const result = await database.query<RuleRow>(
    `SELECT version, definition
     FROM rule_versions
     WHERE kind = 'progression' AND superseded_at IS NULL
     ORDER BY version DESC
     LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { version: row.version, rule: parseProgressionRule(row.definition) };
};

const scoredActivities = (rows: readonly ActivityRow[]): ScoredActivity[] =>
  rows.map((row) => ({
    activeDurationSeconds: row.active_duration_seconds,
    endedAt: row.processed_at
  }));

/** Derived validated activities within `[start, end)`. */
export const derivedActivitiesInWindow = async (
  database: Database,
  accountId: string,
  start: Date,
  end: Date
): Promise<ScoredActivity[]> => {
  const result = await database.query<ActivityRow>(
    `SELECT output.active_duration_seconds, submission.processed_at
     FROM activity_submissions submission
     JOIN activity_validation_outputs output ON output.activity_id = submission.id
     WHERE submission.account_id = $1
       AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND submission.processed_at >= $2
       AND submission.processed_at < $3
     ORDER BY submission.processed_at`,
    [accountId, start, end]
  );
  return scoredActivities(result.rows);
};

/** The account's full derived activity history (for lifetime achievements). */
export const allDerivedActivities = async (
  database: Database,
  accountId: string
): Promise<ScoredActivity[]> => {
  const result = await database.query<ActivityRow>(
    `SELECT output.active_duration_seconds, submission.processed_at
     FROM activity_submissions submission
     JOIN activity_validation_outputs output ON output.activity_id = submission.id
     WHERE submission.account_id = $1
       AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
     ORDER BY submission.processed_at`,
    [accountId]
  );
  return scoredActivities(result.rows);
};

/** The Asia/Kolkata week containing `now` plus its stable date-string identity. */
export const currentWeek = (now: Date): { weekStart: Date; weekEnd: Date; periodStart: string } => {
  const weekStart = weeklyPeriodStart(now);
  return {
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * MILLIS_PER_DAY),
    periodStart: kolkataDate(weekStart)
  };
};

/** Projected XP for the open current week (never persisted). */
export const projectedWeekXp = (
  activities: readonly ScoredActivity[],
  rule: ProgressionRule,
  weekStart: Date
): number =>
  weeklyXpGrants(activities, rule, weekStart).reduce((total, grant) => total + grant.amount, 0);

/**
 * Persisted XP excluding any open-week activity grants. Achievements and quest
 * rewards count immediately regardless of period; activity grants are projected
 * for the current week and only become persisted once the week closes.
 */
export const persistedXpExcludingCurrentActivity = async (
  database: Database,
  accountId: string,
  currentPeriodStart: string
): Promise<number> => {
  const result = await database.query<{ total_xp: string }>(
    `SELECT coalesce(sum(amount), 0)::bigint::text AS total_xp
     FROM xp_entries
     WHERE account_id = $1
       AND NOT (source IN ('active_minutes', 'active_day_consistency') AND period_start >= $2::date)`,
    [accountId, currentPeriodStart]
  );
  return Number(result.rows[0]?.total_xp ?? 0);
};

export const weeklyConsistencyFor = (
  activities: readonly ScoredActivity[],
  rule: ProgressionRule,
  now: Date,
  weekStart: Date
): WeeklyConsistency =>
  weeklyConsistency(activities, {
    now,
    periodStart: weekStart,
    dailyCapMinutes: rule.dailyCapMinutes,
    minMinutesPerActiveDay: rule.minMinutesPerActiveDay,
    goalActiveDays: rule.goalActiveDays
  });
