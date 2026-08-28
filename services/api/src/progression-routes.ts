import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  ProgressionSummarySchema,
  ProgressionSyncResponseSchema,
  type AchievementAward,
  type ProgressionSummary,
  type ProgressionSyncResponse,
  type WeeklyConsistency
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  kolkataDate,
  weeklyPeriodStart,
  weeklyXpGrants,
  xpLevel,
  type ScoredActivity,
  type XpGrant
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import {
  currentWeek,
  derivedActivitiesInWindow,
  loadActiveProgressionRule,
  persistedXpExcludingCurrentActivity,
  projectedWeekXp,
  weeklyConsistencyFor
} from './progression-core.js';

/**
 * Cosmetic progression XP (ADR-0005). XP is finalized per Asia/Kolkata week
 * from server-derived activity and never affects eligibility, matchmaking, or
 * territory value. `GET` returns a live projection for the current week plus
 * previously persisted weeks; `POST /sync` idempotently finalizes closed weeks.
 */
export interface ProgressionRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

interface ActivityRow {
  active_duration_seconds: number;
  processed_at: Date;
}

interface AwardRow {
  id: string;
  achievement_key: string;
  rule_version: string;
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

const awardsFrom = (rows: readonly AwardRow[]): AchievementAward[] =>
  rows.map((row) => ({
    id: row.id,
    achievementKey: row.achievement_key,
    ruleVersion: row.rule_version,
    awardedAt: row.awarded_at.toISOString()
  }));

const insertGrant = async (
  database: Database,
  accountId: string,
  version: number,
  grant: XpGrant
): Promise<void> => {
  await database.query(
    `INSERT INTO xp_entries (account_id, source, amount, rule_version, dedupe_key, period_start)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     ON CONFLICT (account_id, dedupe_key) DO NOTHING`,
    [accountId, grant.source, grant.amount, String(version), grant.dedupeKey, grant.periodStart]
  );
};

/** Ensure the immutable weekly period record exists for a week being closed. */
const ensureWeeklyPeriod = async (database: Database, periodStart: string): Promise<void> => {
  await database.query(
    `INSERT INTO weekly_periods (period_start, period_end)
     VALUES ($1::date, $1::date + 7)
     ON CONFLICT (period_start) DO NOTHING`,
    [periodStart]
  );
};

export const registerProgressionRoutes = ({
  routes,
  database,
  authSecret
}: ProgressionRouteDeps): void => {
  routes.get(
    '/v1/progression',
    {
      schema: {
        tags: ['progression'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ProgressionSummarySchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const loaded = await loadActiveProgressionRule(database);
      const now = new Date();
      const { weekStart, weekEnd, periodStart } = currentWeek(now);

      const persisted = await persistedXpExcludingCurrentActivity(database, accountId, periodStart);

      let totalXp = persisted;
      let consistency: WeeklyConsistency | undefined;
      if (loaded) {
        const activities = await derivedActivitiesInWindow(database, accountId, weekStart, weekEnd);
        totalXp = persisted + projectedWeekXp(activities, loaded.rule, weekStart);
        consistency = weeklyConsistencyFor(activities, loaded.rule, now, weekStart);
      }

      const awards = await database.query<AwardRow>(
        `SELECT id, achievement_key, rule_version, awarded_at
         FROM achievement_awards WHERE account_id = $1 ORDER BY awarded_at DESC`,
        [accountId]
      );

      const summary: ProgressionSummary = {
        totalXp,
        questsCompleted: 0,
        achievements: awardsFrom(awards.rows),
        ...(consistency ? { weeklyConsistency: consistency } : {})
      };
      if (loaded) {
        summary.level = xpLevel(totalXp, loaded.rule.levels);
      }
      return summary;
    }
  );

  routes.post(
    '/v1/progression/sync',
    {
      schema: {
        tags: ['progression'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ProgressionSyncResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const loaded = await loadActiveProgressionRule(database);
      if (!loaded) return reply.code(503).send({ message: 'Progression rule unavailable' });

      // Only closed weeks are immutable; the current (open) week stays a live
      // projection until it rolls over and the next sync call finalizes it.
      const currentStart = weeklyPeriodStart(new Date());
      const rows = await database.query<ActivityRow>(
        `SELECT output.active_duration_seconds, submission.processed_at
         FROM activity_submissions submission
         JOIN activity_validation_outputs output ON output.activity_id = submission.id
         WHERE submission.account_id = $1
           AND submission.status = 'derived'
           AND submission.deleted_at IS NULL
           AND submission.processed_at < $2
         ORDER BY submission.processed_at`,
        [accountId, currentStart]
      );

      const byWeek = new Map<number, ScoredActivity[]>();
      for (const row of rows.rows) {
        const weekStart = weeklyPeriodStart(row.processed_at).getTime();
        const bucket = byWeek.get(weekStart) ?? [];
        bucket.push({
          activeDurationSeconds: row.active_duration_seconds,
          endedAt: row.processed_at
        });
        byWeek.set(weekStart, bucket);
      }

      const grants: XpGrant[] = [];
      for (const [weekStart, activities] of byWeek) {
        const start = new Date(weekStart);
        grants.push(...weeklyXpGrants(activities, loaded.rule, start));
        await ensureWeeklyPeriod(database, kolkataDate(start));
      }
      for (const grant of grants) {
        await insertGrant(database, accountId, loaded.version, grant);
      }

      const response: ProgressionSyncResponse = {
        status: 'synced',
        finalizedWeeks: byWeek.size
      };
      return response;
    }
  );
};
