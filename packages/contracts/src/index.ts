import { Type, type Static } from '@sinclair/typebox';

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.Literal('api'),
    timestamp: Type.String({ format: 'date-time' })
  },
  { $id: 'HealthResponse' }
);

export const QuestSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    distanceKm: Type.Number({ exclusiveMinimum: 0 }),
    durationMinutes: Type.Integer({ minimum: 1 }),
    rewardXp: Type.Integer({ minimum: 0 }),
    accessibility: Type.Union([Type.Literal('step-free'), Type.Literal('mixed')])
  },
  { $id: 'QuestSummary' }
);

export const QuestListResponseSchema = Type.Object(
  { data: Type.Array(QuestSummarySchema) },
  { $id: 'QuestListResponse' }
);

export const QuestParamsSchema = Type.Object(
  { questId: Type.String({ minLength: 1 }) },
  { $id: 'QuestParams' }
);

export const QuestNotFoundResponseSchema = Type.Object(
  { message: Type.Literal('Quest not found') },
  { $id: 'QuestNotFoundResponse' }
);

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type QuestSummary = Static<typeof QuestSummarySchema>;
export type QuestListResponse = Static<typeof QuestListResponseSchema>;
export type QuestParams = Static<typeof QuestParamsSchema>;
