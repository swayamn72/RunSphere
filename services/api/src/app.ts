import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { ApiConfig } from '@runsphere/config';
import {
  HealthResponseSchema,
  QuestListResponseSchema,
  QuestNotFoundResponseSchema,
  QuestParamsSchema,
  QuestSummarySchema,
  type HealthResponse,
  type QuestParams,
  type QuestSummary
} from '@runsphere/contracts';
import { demoQuests, getQuestById } from '@runsphere/domain';
import Fastify, { type FastifyBaseLogger } from 'fastify';

const defaultApiConfig: Pick<ApiConfig, 'allowedOrigins'> = {
  allowedOrigins: ['http://localhost:4173']
};

export const pinoRedactionPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'cookie',
  'token'
] as const;

export interface BuildAppOptions {
  config?: Pick<ApiConfig, 'allowedOrigins'>;
  loggerInstance?: FastifyBaseLogger;
}

export const buildApp = ({ config = defaultApiConfig, loggerInstance }: BuildAppOptions = {}) => {
  const app = loggerInstance
    ? Fastify({ loggerInstance })
    : Fastify({
        logger: {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: { paths: [...pinoRedactionPaths], censor: '[REDACTED]' }
        }
      });

  void app.register(cors, {
    origin(origin, callback) {
      callback(null, origin !== undefined && config.allowedOrigins.includes(origin));
    }
  });
  void app.register(swagger, {
    openapi: {
      info: { title: 'RunSphere API', version: '0.1.0' },
      tags: [
        { name: 'system', description: 'Service health' },
        { name: 'quests', description: 'Quest discovery' }
      ]
    }
  });

  app.register((routes, _options, done) => {
    routes.get(
      '/health',
      {
        schema: {
          tags: ['system'],
          response: { 200: HealthResponseSchema }
        }
      },
      async (): Promise<HealthResponse> => ({
        status: 'ok',
        service: 'api',
        timestamp: new Date().toISOString()
      })
    );

    routes.get(
      '/v1/quests',
      {
        schema: {
          tags: ['quests'],
          response: { 200: QuestListResponseSchema }
        }
      },
      async () => ({ data: demoQuests })
    );

    routes.get<{ Params: QuestParams }>(
      '/v1/quests/:questId',
      {
        schema: {
          tags: ['quests'],
          params: QuestParamsSchema,
          response: { 200: QuestSummarySchema, 404: QuestNotFoundResponseSchema }
        }
      },
      async (request, reply): Promise<QuestSummary | { message: 'Quest not found' }> => {
        const quest = getQuestById(request.params.questId);
        if (!quest) {
          return reply.code(404).send({ message: 'Quest not found' });
        }
        return quest;
      }
    );
    done();
  });

  return app;
};
