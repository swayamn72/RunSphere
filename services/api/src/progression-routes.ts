import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  ProgressionSummarySchema,
  ProgressionSyncResponseSchema,
  type ProgressionRule,
  type ProgressionSummary,
  type ProgressionSyncResponse,
  type WeeklyConsistency
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  MILLIS_PER_DAY,
  kolkataDate,
  parseProgressionRule,
  weeklyConsistency,
  weeklyPeriodStart,
  weeklyXpGrants,
  xpLevel,
  type ScoredActivity,
  type XpGrant
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

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

interface RuleRow {
  version: number;
  definition: unknown;
}

interface LoadedRule {
  version: number;
  rule: ProgressionRule;
}

interface ActivityRow {
  active_duration_seconds: number;
  processed_at: Date;
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

const loadRule = async (database: Database): Promise<LoadedRule | undefined> => {
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

/** Load the week's derived activities within the inclusive/exclusive boundary. */
const activitiesInWindow = async (
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

      const loaded = await loadRule(database);
      const now = new Date();
      const weekStart = weeklyPeriodStart(now);
      const currentPeriodStart = kolkataDate(weekStart);

      const persisted = await database.query<{ total_xp: string }>(
        `SELECT coalesce(sum(amount), 0)::bigint::text AS total_xp
         FROM xp_entries
         WHERE account_id = $1 AND period_start < $2::date`,
        [accountId, currentPeriodStart]
      );
      const persistedXp = Number(persisted.rows[0]?.total_xp ?? 0);

      let projectedXp = 0;
      let consistency: WeeklyConsistency | undefined;
      if (loaded) {
        const activities = await activitiesInWindow(
          database,
          accountId,
          weekStart,
          new Date(weekStart.getTime() + 7 * MILLIS_PER_DAY)
        );
        projectedXp = weeklyXpGrants(activities, loaded.rule, weekStart).reduce(
          (total, grant) => total + grant.amount,
          0
        );
        consistency = weeklyConsistency(activities, {
          now,
          periodStart: weekStart,
          dailyCapMinutes: loaded.rule.dailyCapMinutes,
          minMinutesPerActiveDay: loaded.rule.minMinutesPerActiveDay,
          goalActiveDays: loaded.rule.goalActiveDays
        });
      }

      const totalXp = persistedXp + projectedXp;
      const summary: ProgressionSummary = {
        totalXp,
        questsCompleted: 0,
        achievements: [],
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

      const loaded = await loadRule(database);
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
        grants.push(...weeklyXpGrants(activities, loaded.rule, new Date(weekStart)));
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
