import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AchievementListResponseSchema,
  AchievementSyncResponseSchema,
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  type AchievementListResponse,
  type AchievementStatus,
  type AchievementSyncResponse
} from '@runsphere/contracts';
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
import { verifyAccessToken } from './auth.js';
import {
  allDerivedActivities,
  currentWeek,
  loadActiveProgressionRule,
  persistedXpExcludingCurrentActivity,
  projectedWeekXp
} from './progression-core.js';

/**
 * Pace-neutral cosmetic achievements (ADR-0005). Conditions read only
 * server-derived, capped, non-pace metrics and are evaluated idempotently;
 * an award and its XP grant are recorded together exactly once per account.
 */
export interface AchievementRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

interface DefinitionRow {
  key: string;
  rule_version: string;
  title: string;
  description: string;
  condition: unknown;
  reward_xp: number;
}

interface EarnedRow {
  achievement_key: string;
  awarded_at: Date;
}

const accountIdFrom = (request: FastifyRequest, secret: string): string | undefined => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? verifyAccessToken(value.slice(7), secret) : undefined;
};

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const accountId = accountIdFrom(request, secret);
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

const publishedDefinitions = async (database: Database): Promise<DefinitionRow[]> => {
  const result = await database.query<DefinitionRow>(
    `SELECT key, rule_version, title, description, condition, reward_xp
     FROM achievement_definitions
     WHERE published_at IS NOT NULL AND superseded_at IS NULL
     ORDER BY key`
  );
  return result.rows;
};

const parseDefinition = (row: DefinitionRow): AchievementRule =>
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

export const registerAchievementRoutes = ({
  routes,
  database,
  authSecret
}: AchievementRouteDeps): void => {
  routes.get(
    '/v1/achievements',
    {
      schema: {
        tags: ['progression'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: AchievementListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const [definitions, earned] = await Promise.all([
        publishedDefinitions(database),
        database.query<EarnedRow>(
          `SELECT achievement_key, awarded_at
           FROM achievement_awards WHERE account_id = $1`,
          [accountId]
        )
      ]);

      const earnedByKey = new Map(
        earned.rows.map((row) => [row.achievement_key, row.awarded_at] as const)
      );

      const data: AchievementStatus[] = definitions.map((row) => {
        const awardedAt = earnedByKey.get(row.key);
        return {
          key: row.key,
          ruleVersion: row.rule_version,
          title: row.title,
          description: row.description,
          rewardXp: row.reward_xp,
          earned: awardedAt !== undefined,
          ...(awardedAt ? { awardedAt: awardedAt.toISOString() } : {})
        };
      });

      const response: AchievementListResponse = { data };
      return response;
    }
  );

  routes.post(
    '/v1/achievements/sync',
    {
      schema: {
        tags: ['progression'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: AchievementSyncResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const [activeRule, definitions] = await Promise.all([
        loadActiveProgressionRule(database),
        publishedDefinitions(database)
      ]);
      if (!activeRule) return reply.code(503).send({ message: 'Progression rule unavailable' });

      const parsed = definitions.map((row): { ruleVersion: string; rule: AchievementRule } => ({
        ruleVersion: row.rule_version,
        rule: parseDefinition(row)
      }));
      const lifetime: ScoredActivity[] = await allDerivedActivities(database, accountId);

      const now = new Date();
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

      const earnedRows = await database.query<EarnedRow>(
        `SELECT achievement_key, awarded_at FROM achievement_awards WHERE account_id = $1`,
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

      const response: AchievementSyncResponse = { status: 'synced', newlyAwarded };
      return response;
    }
  );
};
