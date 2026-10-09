import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  QuestDetailSchema,
  QuestListResponseSchema,
  QuestNotFoundResponseSchema,
  QuestParamsSchema,
  WeeklyGoalRequestSchema,
  WeeklyGoalResponseSchema,
  type QuestParams,
  type WeeklyGoalRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { requireAccount } from './auth-routes.js';

export const weeklyGoalResponse = async (database: Database, accountId: string) => {
  const result = await database.query<{
    active_minutes_goal: number | null;
    distance_meters_goal: number | null;
    active_minutes: string;
    distance_meters: string;
    week_starts_on: string;
  }>(
    `SELECT goal.active_minutes_goal, goal.distance_meters_goal,
       coalesce(sum(output.active_duration_seconds) FILTER (WHERE submission.processed_at >= date_trunc('week', now())), 0)::text AS active_minutes,
       coalesce(sum(output.distance_meters) FILTER (WHERE submission.processed_at >= date_trunc('week', now())), 0)::text AS distance_meters,
       to_char(date_trunc('week', now())::date, 'YYYY-MM-DD') AS week_starts_on
     FROM (SELECT $1::uuid AS account_id) account
     LEFT JOIN weekly_activity_goals goal ON goal.account_id = account.account_id
     LEFT JOIN activity_submissions submission ON submission.account_id = account.account_id
       AND submission.status = 'derived' AND submission.deleted_at IS NULL
     LEFT JOIN activity_validation_outputs output ON output.activity_id = submission.id
     GROUP BY goal.active_minutes_goal, goal.distance_meters_goal`,
    [accountId]
  );
  const row = result.rows[0]!;
  return {
    weekStartsOn: row.week_starts_on,
    activeMinutes: {
      ...(row.active_minutes_goal ? { goal: Number(row.active_minutes_goal) } : {}),
      actual: Math.floor(Number(row.active_minutes) / 60)
    },
    distanceMeters: {
      ...(row.distance_meters_goal ? { goal: Number(row.distance_meters_goal) } : {}),
      actual: Math.round(Number(row.distance_meters))
    }
  };
};

export interface QuestRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

export const registerQuestRoutes = ({ routes, database, authSecret }: QuestRouteDeps) => {
  routes.get(
    '/v1/quests',
    {
      schema: {
        tags: ['quests'],
        response: { 200: QuestListResponseSchema, 503: ErrorResponseSchema }
      }
    },
    async (_request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const quests = await database.query<{
        id: string;
        title: string;
        distance_meters: number;
        estimated_active_minutes: number;
        accessibility: 'step-free' | 'mixed' | 'unknown';
        open_hours: unknown;
        checkpoint_count: string;
      }>(
        `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
           quest.open_hours, count(link.checkpoint_id)::text AS checkpoint_count
         FROM published_quest_versions quest
         JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
         GROUP BY quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes,
           quest.accessibility, quest.open_hours, quest.published_at
         ORDER BY quest.published_at DESC LIMIT 100`
      );
      return {
        data: quests.rows.map((quest) => ({
          id: quest.id,
          title: quest.title,
          distanceMeters: Number(quest.distance_meters),
          estimatedActiveMinutes: Number(quest.estimated_active_minutes),
          accessibility: quest.accessibility,
          openHours: quest.open_hours,
          checkpointCount: Number(quest.checkpoint_count)
        }))
      };
    }
  );
  routes.get<{ Params: QuestParams }>(
    '/v1/quests/:questId',
    {
      schema: {
        tags: ['quests'],
        params: QuestParamsSchema,
        response: {
          200: QuestDetailSchema,
          404: QuestNotFoundResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const quests = await database.query<{
        id: string;
        title: string;
        distance_meters: number;
        estimated_active_minutes: number;
        accessibility: 'step-free' | 'mixed' | 'unknown';
        open_hours: unknown;
        source_reviewed_at: Date | string;
        checkpoints: unknown;
      }>(
        `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
           quest.open_hours, quest.source_reviewed_at,
           jsonb_agg(jsonb_build_object('id', checkpoint.id, 'kind', checkpoint.checkpoint_kind,
             'title', checkpoint.title, 'geometry', ST_AsGeoJSON(checkpoint.geometry)::jsonb,
             'geometryVersion', checkpoint.geometry_version,
             'accessibility', coalesce(checkpoint.accessibility->>'level', 'unknown'),
             'openHours', checkpoint.open_hours) ORDER BY link.position) AS checkpoints
         FROM published_quest_versions quest
         JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
         JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
         WHERE quest.id = $1
         GROUP BY quest.id`,
        [request.params.questId]
      );
      const quest = quests.rows[0];
      return quest
        ? {
            id: quest.id,
            title: quest.title,
            distanceMeters: Number(quest.distance_meters),
            estimatedActiveMinutes: Number(quest.estimated_active_minutes),
            accessibility: quest.accessibility,
            openHours: quest.open_hours,
            checkpointCount: Array.isArray(quest.checkpoints) ? quest.checkpoints.length : 0,
            checkpoints: quest.checkpoints,
            sourceReviewedAt: new Date(quest.source_reviewed_at).toISOString()
          }
        : reply.code(404).send({ message: 'Quest not found' });
    }
  );

  routes.put<{ Body: WeeklyGoalRequest }>(
    '/v1/goals/weekly',
    {
      schema: {
        tags: ['goals'],
        headers: ActivityAuthorizationHeadersSchema,
        body: WeeklyGoalRequestSchema,
        response: {
          200: WeeklyGoalResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      await database.query(
        `INSERT INTO weekly_activity_goals (account_id, active_minutes_goal, distance_meters_goal)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET active_minutes_goal = EXCLUDED.active_minutes_goal,
           distance_meters_goal = EXCLUDED.distance_meters_goal, updated_at = now()`,
        [accountId, request.body.activeMinutes ?? null, request.body.distanceMeters ?? null]
      );
      const response = await weeklyGoalResponse(database, accountId);
      return response;
    }
  );
  routes.get(
    '/v1/goals/weekly',
    {
      schema: {
        tags: ['goals'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: WeeklyGoalResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      return weeklyGoalResponse(database, accountId);
    }
  );
};
