import { withTransaction, type Database } from '@runsphere/db';
import {
  evaluateAchievements,
  kolkataDate,
  parseAchievementRule,
  weeklyPeriodStart,
  xpLevel,
  type AchievementRule,
  type ScoredActivity
} from '@runsphere/domain';
import {
  allDerivedActivities,
  currentWeek,
  loadActiveProgressionRule,
  persistedXpExcludingCurrentActivity,
  projectedWeekXp
} from './progression-core.js';

/**
 * Achievement evaluation shared by `POST /v1/achievements/sync` and the
 * worker (M1.7). The worker calls it as each run is derived, so an award no
 * longer waits for the runner to open the Achievements screen. Both paths are
 * idempotent: an award and its XP grant are inserted together, once per
 * account and key, so running it twice, or from both places at once, awards
 * nothing extra.
 */
export interface AchievementDefinitionRow {
  key: string;
  rule_version: string;
  title: string;
  description: string;
  condition: unknown;
  reward_xp: number;
}

export const publishedAchievementDefinitions = async (
  database: Database
): Promise<AchievementDefinitionRow[]> => {
  const result = await database.query<AchievementDefinitionRow>(
    `SELECT key, rule_version, title, description, condition, reward_xp
     FROM achievement_definitions
     WHERE published_at IS NOT NULL AND superseded_at IS NULL
     ORDER BY key`
  );
  return result.rows;
};

const parseDefinition = (row: AchievementDefinitionRow): AchievementRule =>
  parseAchievementRule({
    key: row.key,
    title: row.title,
    description: row.description,
    condition: row.condition,
    rewardXp: row.reward_xp
  });

/** Insert the award + its XP grant atomically, exactly once per account. */
const award = async (
  database: Database,
  accountId: string,
  ruleVersion: string,
  achievement: AchievementRule,
  periodStart: string
): Promise<boolean> =>
  withTransaction(database, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO achievement_awards (account_id, achievement_key, rule_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, achievement_key) DO NOTHING
       RETURNING id`,
      [accountId, achievement.key, ruleVersion]
    );
    if (!inserted.rows[0]) return false;
    await client.query(
      `INSERT INTO xp_entries (account_id, source, amount, rule_version, dedupe_key, period_start)
       VALUES ($1, 'achievement', $2, $3, $4, $5::date)
       ON CONFLICT (account_id, dedupe_key) DO NOTHING`,
      [accountId, achievement.rewardXp, ruleVersion, `achievement:${achievement.key}`, periodStart]
    );
    return true;
  });

export type AchievementSyncOutcome =
  { readonly status: 'no_rule' } | { readonly status: 'synced'; readonly newlyAwarded: number };

export const syncAchievements = async (
  database: Database,
  accountId: string,
  now: Date = new Date()
): Promise<AchievementSyncOutcome> => {
  const [activeRule, definitions] = await Promise.all([
    loadActiveProgressionRule(database),
    publishedAchievementDefinitions(database)
  ]);
  if (!activeRule) return { status: 'no_rule' };

  const parsed = definitions.map((row) => ({
    ruleVersion: row.rule_version,
    rule: parseDefinition(row)
  }));
  const lifetime: ScoredActivity[] = await allDerivedActivities(database, accountId);

  const { weekStart, periodStart } = currentWeek(now);
  const persisted = await persistedXpExcludingCurrentActivity(database, accountId, periodStart);
  const totalXp = persisted + projectedWeekXp(lifetime, activeRule.rule, weekStart);
  const level = xpLevel(totalXp, activeRule.rule.levels).level;

  const satisfiedKeys = new Set(
    evaluateAchievements(
      {
        activities: lifetime,
        dailyCapMinutes: activeRule.rule.dailyCapMinutes,
        minMinutesPerActiveDay: activeRule.rule.minMinutesPerActiveDay,
        totalXp,
        level
      },
      parsed.map((entry) => entry.rule)
    ).map((rule) => rule.key)
  );

  const earnedRows = await database.query<{ achievement_key: string }>(
    `SELECT achievement_key FROM achievement_awards WHERE account_id = $1`,
    [accountId]
  );
  const alreadyEarned = new Set(earnedRows.rows.map((row) => row.achievement_key));

  let newlyAwarded = 0;
  for (const entry of parsed) {
    if (!satisfiedKeys.has(entry.rule.key) || alreadyEarned.has(entry.rule.key)) continue;
    const awardedNow = await award(
      database,
      accountId,
      entry.ruleVersion,
      entry.rule,
      kolkataDate(weeklyPeriodStart(now))
    );
    if (awardedNow) newlyAwarded += 1;
  }
  return { status: 'synced', newlyAwarded };
};

/**
 * The worker's hook after a run is processed: evaluate achievements for the
 * run's owner when the run was derived. A rejected or deleted run changes no
 * achievement, so it is skipped.
 */
export const syncAchievementsForActivity = async (
  database: Database,
  activityId: string,
  now: Date = new Date()
): Promise<AchievementSyncOutcome | undefined> => {
  const owner = await database.query<{ account_id: string }>(
    `SELECT account_id FROM activity_submissions
     WHERE id = $1 AND status = 'derived' AND deleted_at IS NULL`,
    [activityId]
  );
  const accountId = owner.rows[0]?.account_id;
  return accountId ? syncAchievements(database, accountId, now) : undefined;
};
