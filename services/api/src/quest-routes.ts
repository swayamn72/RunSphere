import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  MyQuestListResponseSchema,
  QuestAcceptResponseSchema,
  QuestDetailSchema,
  QuestListResponseSchema,
  QuestNotFoundResponseSchema,
  QuestParamsSchema,
  StaffQuestListResponseSchema,
  StaffQuestSchema,
  StaffQuestTimeLimitRequestSchema,
  WeeklyGoalRequestSchema,
  WeeklyGoalResponseSchema,
  type QuestParams,
  type StaffQuest,
  type StaffQuestTimeLimitRequest,
  type WeeklyGoalRequest
} from '@runsphere/contracts';
import { canOperateCompetitions } from '@runsphere/domain';
import type { Database } from '@runsphere/db';
import { requireAccount } from './auth-routes.js';
import { abandonQuest, acceptQuest, myQuests } from './quest-core.js';
import { staffRoles } from './staff-roles.js';

/**
 * The weekly goal's progress for the Asia/Kolkata week containing `now`
 * (ADR-0006). This used `date_trunc('week', now())`, which is the server's
 * (UTC) week, so a run between Sunday 18:30 and 24:00 UTC, which is already
 * Monday in India, counted toward the previous week (B10).
 */
export const weeklyGoalResponse = async (
  database: Database,
  accountId: string,
  now: Date = new Date()
) => {
  const result = await database.query<{
    active_minutes_goal: number | null;
    distance_meters_goal: number | null;
    active_minutes: string;
    distance_meters: string;
    week_starts_on: string;
  }>(
    `WITH week AS (
       SELECT local_start,
         local_start AT TIME ZONE 'Asia/Kolkata' AS starts_at,
         (local_start + interval '7 days') AT TIME ZONE 'Asia/Kolkata' AS ends_at
       FROM (SELECT date_trunc('week', $2::timestamptz AT TIME ZONE 'Asia/Kolkata') AS local_start) monday
     )
     SELECT goal.active_minutes_goal, goal.distance_meters_goal,
       coalesce(sum(output.active_duration_seconds) FILTER (WHERE submission.processed_at >= week.starts_at AND submission.processed_at < week.ends_at), 0)::text AS active_minutes,
       coalesce(sum(output.distance_meters) FILTER (WHERE submission.processed_at >= week.starts_at AND submission.processed_at < week.ends_at), 0)::text AS distance_meters,
       to_char(week.local_start::date, 'YYYY-MM-DD') AS week_starts_on
     FROM (SELECT $1::uuid AS account_id) account
     CROSS JOIN week
     LEFT JOIN weekly_activity_goals goal ON goal.account_id = account.account_id
     LEFT JOIN activity_submissions submission ON submission.account_id = account.account_id
       AND submission.status = 'derived' AND submission.deleted_at IS NULL
     LEFT JOIN activity_validation_outputs output ON output.activity_id = submission.id
     GROUP BY goal.active_minutes_goal, goal.distance_meters_goal, week.local_start`,
    [accountId, now]
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
  /** The reader's quests: taken on, and finished (M6.3). */
  routes.get(
    '/v1/quests/mine',
    {
      schema: {
        tags: ['quests'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: MyQuestListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      return { data: await myQuests(database, accountId) };
    }
  );

  /**
   * Take a quest on. Completion is never asked for: the worker checks each
   * run you finish against the quest's checkpoints (`quest-core.ts`).
   */
  routes.post<{ Params: QuestParams }>(
    '/v1/quests/:questId/accept',
    {
      schema: {
        tags: ['quests'],
        params: QuestParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: QuestAcceptResponseSchema,
          401: ErrorResponseSchema,
          404: QuestNotFoundResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!/^[0-9a-f-]{36}$/i.test(request.params.questId))
        return reply.code(404).send({ message: 'Quest not found' });
      const accepted = await acceptQuest(database, accountId, request.params.questId);
      if (!accepted) return reply.code(404).send({ message: 'Quest not found' });
      return { status: accepted.status, acceptedAt: accepted.acceptedAt.toISOString() };
    }
  );

  routes.delete<{ Params: QuestParams }>(
    '/v1/quests/:questId/accept',
    {
      schema: {
        tags: ['quests'],
        params: QuestParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const dropped = await abandonQuest(database, accountId, request.params.questId);
      if (!dropped) return reply.code(404).send({ message: 'No open quest to drop' });
      return reply.code(204).send();
    }
  );

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
        map_position?: [number, number] | null;
        time_limit_minutes: number | null;
      }>(
        `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
           quest.open_hours, quest.time_limit_minutes, count(link.checkpoint_id)::text AS checkpoint_count,
           ((array_agg(ST_AsGeoJSON(ST_PointOnSurface(checkpoint.geometry))::jsonb ORDER BY link.position))[1])->'coordinates' AS map_position
         FROM published_quest_versions quest
         JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
         JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
         GROUP BY quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes,
           quest.accessibility, quest.open_hours, quest.time_limit_minutes, quest.published_at
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
          checkpointCount: Number(quest.checkpoint_count),
          ...(quest.map_position ? { mapPosition: quest.map_position } : {}),
          ...(quest.time_limit_minutes ? { timeLimitMinutes: quest.time_limit_minutes } : {})
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
        time_limit_minutes: number | null;
        map_position: [number, number] | null;
      }>(
        `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes, quest.accessibility,
           quest.open_hours, quest.source_reviewed_at, quest.time_limit_minutes,
           ((array_agg(ST_AsGeoJSON(ST_PointOnSurface(checkpoint.geometry))::jsonb ORDER BY link.position))[1])->'coordinates' AS map_position,
           jsonb_agg(jsonb_build_object('id', checkpoint.id, 'kind', checkpoint.checkpoint_kind,
             'title', checkpoint.title, 'geometry', ST_AsGeoJSON(checkpoint.geometry)::jsonb,
             'geometryVersion', checkpoint.geometry_version,
             'accessibility', coalesce(checkpoint.accessibility->>'level', 'unknown'),
             'openHours', checkpoint.open_hours) ORDER BY link.position) AS checkpoints
         FROM published_quest_versions quest
         JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
         JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
         WHERE quest.id = $1
         GROUP BY quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes,
           quest.accessibility, quest.open_hours, quest.source_reviewed_at, quest.time_limit_minutes`,
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
            sourceReviewedAt: new Date(quest.source_reviewed_at).toISOString(),
            ...(quest.map_position ? { mapPosition: quest.map_position } : {}),
            ...(quest.time_limit_minutes ? { timeLimitMinutes: quest.time_limit_minutes } : {})
          }
        : reply.code(404).send({ message: 'Quest not found' });
    }
  );

  /**
   * Quests for the console's Quests area, published or not, with their time
   * limits. Gated like competitions: season_operator or admin. Reads are
   * audited like every staff read.
   */
  routes.get(
    '/v1/staff/quests',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: StaffQuestListResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canOperateCompetitions(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Managing quests needs a staff role' });
      const rows = await database.query<StaffQuestRow>(
        `${STAFF_QUEST_SELECT}
         GROUP BY quest.id ORDER BY quest.published_at DESC NULLS LAST, quest.title LIMIT 200`
      );
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'quest.listed', 'quest', $2)`,
        [accountId, rows.rows.length]
      );
      return { data: rows.rows.map(staffQuestFrom) };
    }
  );

  /**
   * Set or clear a quest's time limit. It applies to quest runs checked after
   * the change, so a run already uploaded keeps the rule it was checked under.
   */
  routes.put<{ Params: QuestParams; Body: StaffQuestTimeLimitRequest }>(
    '/v1/staff/quests/:questId/time-limit',
    {
      schema: {
        tags: ['staff'],
        headers: ActivityAuthorizationHeadersSchema,
        params: QuestParamsSchema,
        body: StaffQuestTimeLimitRequestSchema,
        response: {
          200: StaffQuestSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!canOperateCompetitions(await staffRoles(database, accountId)))
        return reply.code(403).send({ message: 'Managing quests needs a staff role' });
      if (!UUID.test(request.params.questId))
        return reply.code(404).send({ message: 'Quest not found' });
      const updated = await database.query(
        'UPDATE quest_versions SET time_limit_minutes = $2 WHERE id = $1 RETURNING id',
        [request.params.questId, request.body.timeLimitMinutes]
      );
      if (!updated.rows[0]) return reply.code(404).send({ message: 'Quest not found' });
      await database.query(
        `INSERT INTO staff_audit_events (staff_account_id, action, target_type, target_count)
         VALUES ($1, 'quest.time_limit_set', 'quest', 1)`,
        [accountId]
      );
      const row = await database.query<StaffQuestRow>(
        `${STAFF_QUEST_SELECT} WHERE quest.id = $1 GROUP BY quest.id`,
        [request.params.questId]
      );
      return staffQuestFrom(row.rows[0]!);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StaffQuestRow {
  id: string;
  title: string;
  estimated_active_minutes: number;
  time_limit_minutes: number | null;
  published: boolean;
  checkpoint_count: string;
}

const STAFF_QUEST_SELECT = `SELECT quest.id, quest.title, quest.estimated_active_minutes,
     quest.time_limit_minutes,
     (quest.published_at IS NOT NULL AND quest.unpublished_at IS NULL) AS published,
     count(link.checkpoint_id)::text AS checkpoint_count
   FROM quest_versions quest
   LEFT JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id`;

const staffQuestFrom = (row: StaffQuestRow): StaffQuest => ({
  id: row.id,
  title: row.title,
  checkpointCount: Number(row.checkpoint_count),
  estimatedActiveMinutes: Number(row.estimated_active_minutes),
  timeLimitMinutes: row.time_limit_minutes,
  published: row.published
});
