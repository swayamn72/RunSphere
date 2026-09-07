import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ErrorResponseSchema,
  QuestRecommendationQuerySchema,
  QuestRecommendationResponseSchema,
  type QuestRecommendationQuery,
  type QuestRecommendationResponse
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  QUEST_RECOMMENDATION_RADIUS_METRES,
  recommendQuests,
  type QuestCandidate
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';

/**
 * `GET /v1/quests/recommended` (`ml.md` System 2).
 *
 * **Coarse in, nothing out.** The position is rounded before it touches a
 * query — the same treatment `route-suggestion-routes.ts` gives it — used to
 * filter within 20 km, and then discarded. Nothing here writes a coordinate,
 * and `ml.md` requires exactly that: location "is never stored as training
 * data".
 *
 * **The list is honest about what it is.** With no interaction history, or no
 * model, it comes back sorted by distance and labelled `proximity`. That is
 * the state this ships in and will stay in until something records a quest
 * acceptance (`045` explains why nothing does yet).
 */

export interface QuestRecommendationRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
  /**
   * Scores for one account's candidate quests, when a recommender is
   * configured. Absent means cold start, which is not an error.
   */
  recommender?: (input: {
    readonly accountId: string;
    readonly questIds: readonly string[];
  }) => Promise<ReadonlyMap<string, number>>;
}

/**
 * About a kilometre. The same grid `route-suggestion-routes.ts` snaps to: a
 * 20 km filter does not need more, and a precise position in a query string is
 * a precise position in an access log.
 */
const COARSE_DEGREES = 0.01;
const snapCoarse = (value: number): number => Math.round(value / COARSE_DEGREES) * COARSE_DEGREES;

const accountIdFrom = (request: FastifyRequest, secret: string): string | undefined => {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return verifyAccessToken(header.slice('Bearer '.length), secret);
};

export const registerQuestRecommendationRoutes = ({
  routes,
  database,
  authSecret,
  recommender
}: QuestRecommendationRouteDeps): void => {
  routes.get<{ Querystring: QuestRecommendationQuery }>(
    '/v1/quests/recommended',
    {
      schema: {
        tags: ['quests'],
        querystring: QuestRecommendationQuerySchema,
        response: {
          200: QuestRecommendationResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = accountIdFrom(request, authSecret);
      if (!accountId) return reply.code(401).send({ message: 'Unauthorized' });

      const latitude = snapCoarse(request.query.latitude);
      const longitude = snapCoarse(request.query.longitude);

      // Published quests near the coarse point, with how far their nearest
      // checkpoint is. `::geography` so the radius is metres and not degrees —
      // the same cast the route suggestions needed, and the same bug if it is
      // missing: 20,000 degrees is every quest on earth.
      const nearby = await database.query<{
        id: string;
        title: string;
        distance_meters: number;
        estimated_active_minutes: number;
        accessibility: 'step-free' | 'mixed' | 'unknown';
        away_metres: number;
        seen: boolean;
      }>(
        `SELECT quest.id, quest.title, quest.distance_meters, quest.estimated_active_minutes,
           quest.accessibility,
           min(ST_Distance(checkpoint.geometry::geography,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)) AS away_metres,
           bool_or(acceptance.id IS NOT NULL) AS seen
         FROM published_quest_versions quest
         JOIN quest_version_checkpoints link ON link.quest_version_id = quest.id
         JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
         LEFT JOIN quest_acceptances acceptance
           ON acceptance.quest_version_id = quest.id AND acceptance.account_id = $4
         WHERE checkpoint.retired_at IS NULL
         GROUP BY quest.id, quest.title, quest.distance_meters,
           quest.estimated_active_minutes, quest.accessibility
         HAVING min(ST_Distance(checkpoint.geometry::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)) <= $3
         ORDER BY away_metres
         LIMIT 50`,
        [longitude, latitude, QUEST_RECOMMENDATION_RADIUS_METRES, accountId]
      );

      // How much this account has actually done. Below the cold-start floor the
      // model's opinion is one data point wearing a confident face.
      const interactions = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM quest_interactions
         WHERE account_id = $1 AND weight > 0`,
        [accountId]
      );
      const interactionCount = Number(interactions.rows[0]?.count ?? 0);

      const scores = recommender
        ? await recommender({
            accountId,
            questIds: nearby.rows.map((row) => row.id)
          }).catch(() => new Map<string, number>())
        : new Map<string, number>();

      const candidates: QuestCandidate[] = nearby.rows.map((row) => {
        const score = scores.get(row.id);
        return {
          questId: row.id,
          distanceMetres: Number(row.away_metres),
          seen: row.seen === true,
          ...(typeof score === 'number' ? { score } : {})
        };
      });

      const ranked = recommendQuests(candidates, interactionCount);
      const byId = new Map(nearby.rows.map((row) => [row.id, row]));

      const response: QuestRecommendationResponse = {
        data: ranked.data.flatMap((entry) => {
          const row = byId.get(entry.questId);
          if (!row) return [];
          return [
            {
              id: row.id,
              title: row.title,
              distanceMeters: Number(row.distance_meters),
              estimatedActiveMinutes: Number(row.estimated_active_minutes),
              accessibility: row.accessibility,
              awayMetres: Math.round(entry.distanceMetres)
            }
          ];
        }),
        basis: ranked.basis,
        note: ranked.note
      };
      return response;
    }
  );
};
