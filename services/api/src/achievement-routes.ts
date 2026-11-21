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
import type { Database } from '@runsphere/db';
import { verifyAccessToken } from './auth.js';
import { publishedAchievementDefinitions, syncAchievements } from './achievement-core.js';

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
        publishedAchievementDefinitions(database),
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

      const outcome = await syncAchievements(database, accountId);
      if (outcome.status === 'no_rule')
        return reply.code(503).send({ message: 'Progression rule unavailable' });
      const response: AchievementSyncResponse = {
        status: 'synced',
        newlyAwarded: outcome.newlyAwarded
      };
      return response;
    }
  );
};
