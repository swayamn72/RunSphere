import { Type, type Static } from '@sinclair/typebox';
import { Strict, UuidSchema } from './common.js';

/**
 * Quest recommendations (`ml.md` System 2).
 *
 * **Location is used and not stored.** `ml.md`: "Location is only used at
 * serving time (filtering within 20 km) and is never stored as training data."
 * The request takes a coarse position, the response echoes none of it back, and
 * nothing on the way through writes it down.
 */

export const QuestRecommendationQuerySchema = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 })
  },
  { ...Strict, $id: 'QuestRecommendationQuery' }
);

export const QuestRecommendationSchema = Type.Object(
  {
    id: UuidSchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    distanceMeters: Type.Number({ minimum: 0 }),
    estimatedActiveMinutes: Type.Integer({ minimum: 0 }),
    accessibility: Type.Union([
      Type.Literal('step-free'),
      Type.Literal('mixed'),
      Type.Literal('unknown')
    ]),
    /** How far its nearest checkpoint is from the coarse position given. */
    awayMetres: Type.Number({ minimum: 0 })
  },
  { $id: 'QuestRecommendation' }
);

export const QuestRecommendationResponseSchema = Type.Object(
  {
    data: Type.Array(QuestRecommendationSchema, { maxItems: 5 }),
    /**
     * Which of the two this list actually is.
     *
     * `proximity` is not a failure state and is not hidden: until enough
     * quests have been accepted and finished, sorting by distance is the
     * honest answer, and presenting it as a personal recommendation would be a
     * claim about somebody the system cannot support.
     */
    basis: Type.Union([Type.Literal('model'), Type.Literal('proximity')]),
    note: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'QuestRecommendationResponse' }
);

export type QuestRecommendationQuery = Static<typeof QuestRecommendationQuerySchema>;
export type QuestRecommendationItem = Static<typeof QuestRecommendationSchema>;
export type QuestRecommendationResponse = Static<typeof QuestRecommendationResponseSchema>;
