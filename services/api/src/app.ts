import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { ApiConfig, LegalContact } from '@runsphere/config';
import { pinoRedactionPaths, requestLogSerializer } from '@runsphere/config';
import { createMetrics } from '@runsphere/observability';
import { HealthResponseSchema, ReadinessResponseSchema } from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { registerAuthRoutes } from './auth-routes.js';
import { registerSafetyRoutes } from './safety-routes.js';
import { registerActivityRoutes } from './activity-routes.js';
import { registerRunLogRoutes } from './run-log-routes.js';
import { registerQuestRoutes } from './quest-routes.js';
import { registerAccountPrivacyRoutes } from './account-privacy-routes.js';
import { registerAccountDeletionPages } from './account-deletion-pages.js';
import { registerEmailLinkPages } from './email-link-pages.js';
import { registerLegalPages } from './legal-pages.js';
import { registerStaffRoutes } from './staff-routes.js';
import { registerGamificationRoutes } from './gamification-routes.js';
import { registerAccountLifecycleRoutes } from './account-routes.js';
import { registerProgressionRoutes } from './progression-routes.js';
import { registerAchievementRoutes } from './achievement-routes.js';
import { registerChallengeRoutes } from './challenge-routes.js';
import { registerClubRoutes } from './club-routes.js';
import { registerGlobalBoardRoutes } from './global-board-routes.js';
import { registerCompetitionRoutes } from './competition-routes.js';
import { registerModerationRoutes } from './moderation-routes.js';
import { registerCampaignRoutes } from './campaign-routes.js';
import { registerGovernanceRoutes } from './governance-routes.js';
import { registerTerritoryRoutes } from './territory-routes.js';
import { registerTerritorySeasonRoutes } from './territory-season-routes.js';
import { registerTerritoryClaimRoutes } from './territory-claim-routes.js';
import { registerTerritoryBoardRoutes } from './territory-board-routes.js';
import { registerEmailWebhookRoutes } from './email-webhook-routes.js';
import { registerRouteSuggestionRoutes } from './route-suggestion-routes.js';
import { registerQuestRecommendationRoutes } from './quest-recommendation-routes.js';
import { createMlScorer, readMlScorerConfig } from './ml-scoring.js';
import { registerRateLimits } from './rate-limit.js';
import { registerSessionCheck } from './session-check.js';
import { registerSocialIdentityRoutes } from './social-identity-routes.js';

type RuntimeApiConfig = Pick<ApiConfig, 'allowedOrigins' | 'staffReviewAccountIds'> & {
  metricsCollectorToken: string | undefined;
  legalContact: LegalContact;
};
const defaultApiConfig: RuntimeApiConfig = {
  allowedOrigins: ['http://localhost:4173'],
  staffReviewAccountIds: [],
  metricsCollectorToken: undefined,
  legalContact: {}
};
const configuredApiConfig = (config: BuildAppOptions['config']): RuntimeApiConfig => ({
  allowedOrigins: config?.allowedOrigins ?? defaultApiConfig.allowedOrigins,
  staffReviewAccountIds: config?.staffReviewAccountIds ?? defaultApiConfig.staffReviewAccountIds,
  metricsCollectorToken: config?.metricsCollectorToken ?? defaultApiConfig.metricsCollectorToken,
  legalContact: config?.legalContact ?? defaultApiConfig.legalContact
});
export { pinoRedactionPaths };

export interface BuildAppOptions {
  config?: Partial<
    Pick<
      ApiConfig,
      'allowedOrigins' | 'staffReviewAccountIds' | 'metricsCollectorToken' | 'legalContact'
    >
  >;
  loggerInstance?: FastifyBaseLogger;
  db?: Database;
  authSecret?: string;
  allowInsecureAuthSecret?: boolean;
  /**
   * Request rate limits (R5). On by default; off when `NODE_ENV=test`, because
   * the integration suites deliberately make dozens of claims per account.
   * Tests of the limiter itself pass `true`.
   */
  rateLimits?: boolean;
  /**
   * End access tokens as soon as their session or account ends (R3). On by
   * default; off under `NODE_ENV=test`, where unit tests use fake databases
   * with no account rows. Its own integration test passes `true`.
   */
  sessionChecks?: boolean;
}

/**
 * Which proxies may set `X-Forwarded-For` (R4). Rate limits key on
 * `request.ip`; behind a load balancer without this, every client shares the
 * balancer's address, so one person's attempts throttle everyone. Off by
 * default, because trusting the header with no proxy in front lets any client
 * choose its own IP. Accepts `true` (trust every hop; only behind a proxy that
 * overwrites the header) or, preferably, a comma-separated list of proxy
 * addresses or CIDRs.
 */
export const parseTrustProxy = (value: string | undefined): boolean | string[] => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const assertAuthSecret = (secret: string, allowed: boolean) => {
  if (!allowed && (secret.length < 32 || secret === 'development-secret-not-for-production')) {
    throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters outside tests.');
  }
};

export const buildApp = ({
  config: apiConfig,
  loggerInstance,
  db,
  authSecret = process.env.AUTH_TOKEN_SECRET ?? 'development-secret-not-for-production',
  allowInsecureAuthSecret = process.env.NODE_ENV === 'test',
  rateLimits = process.env.NODE_ENV !== 'test',
  sessionChecks = process.env.NODE_ENV !== 'test'
}: BuildAppOptions = {}) => {
  assertAuthSecret(authSecret, allowInsecureAuthSecret);
  const config = configuredApiConfig(apiConfig);
  const database = db;
  const metrics = createMetrics();
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const app = loggerInstance
    ? Fastify({ loggerInstance, trustProxy })
    : Fastify({
        trustProxy,
        logger: {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: { paths: [...pinoRedactionPaths], censor: '[REDACTED]' },
          serializers: { req: requestLogSerializer }
        }
      });
  if (rateLimits) registerRateLimits(app, authSecret);
  if (sessionChecks && database) registerSessionCheck(app, database, authSecret);
  app.addHook('onResponse', async (_request, reply) => {
    metrics.recordResponse(reply.statusCode);
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
        { name: 'auth', description: 'Adult account authentication' },
        { name: 'activities', description: 'Private activity ingestion' },
        { name: 'staff', description: 'Authenticated, audited staff review' }
      ]
    }
  });

  app.register((routes, _options, done) => {
    routes.get(
      '/health',
      { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } },
      async () => ({
        status: 'ok' as const,
        service: 'api' as const,
        timestamp: new Date().toISOString()
      })
    );
    routes.get(
      '/ready',
      {
        schema: {
          tags: ['system'],
          response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema }
        }
      },
      async (_request, reply) => {
        if (!database) return reply.code(503).send({ status: 'not_ready', service: 'api' });
        try {
          await database.query('SELECT 1');
          return { status: 'ready' as const, service: 'api' as const };
        } catch {
          return reply.code(503).send({ status: 'not_ready', service: 'api' });
        }
      }
    );
    routes.get('/metrics', async (request, reply) => {
      const token = config.metricsCollectorToken;
      if (!token) return reply.code(404).send({ message: 'Not found' });
      if (request.headers.authorization !== `Bearer ${token}`)
        return reply.code(401).send({ message: 'Unauthorized' });
      return reply
        .type('text/plain; version=0.0.4; charset=utf-8')
        .send(metrics.renderPrometheus('api'));
    });
    registerStaffRoutes({ routes, database, authSecret, config });
    registerAuthRoutes({ routes, database, authSecret });
    registerQuestRoutes({ routes, database, authSecret });
    registerAccountPrivacyRoutes({ routes, database, authSecret });
    registerAccountDeletionPages({ routes });
    registerEmailLinkPages({ routes, database });
    registerLegalPages({ routes, contact: config.legalContact });
    registerSafetyRoutes({ routes, database, authSecret });
    registerActivityRoutes({ routes, database, authSecret });
    registerRunLogRoutes({ routes, database, authSecret });

    registerGamificationRoutes({ routes, database, authSecret });
    registerSocialIdentityRoutes({ routes, database, authSecret });
    registerAccountLifecycleRoutes({ routes, database, authSecret });
    registerProgressionRoutes({ routes, database, authSecret });
    registerAchievementRoutes({ routes, database, authSecret });
    registerChallengeRoutes({ routes, database, authSecret });
    registerClubRoutes({ routes, database, authSecret });
    registerGlobalBoardRoutes({ routes, database, authSecret });
    registerCompetitionRoutes({ routes, database, authSecret });
    registerModerationRoutes({ routes, database, authSecret });
    registerCampaignRoutes({ routes, database, authSecret });
    registerGovernanceRoutes({ routes, database, authSecret });
    registerTerritoryRoutes({ routes, database, authSecret });
    registerTerritorySeasonRoutes({ routes, database, authSecret });
    // The anti-cheat scorer, when one is configured. Unconfigured is the
    // normal state: no `ML_SCORER_URL` means no call and no flag, and a claim
    // behaves exactly as it did before the model existed (`ml.md`).
    const mlScorerConfig = readMlScorerConfig(process.env);
    const mlScorer = mlScorerConfig ? createMlScorer(mlScorerConfig) : undefined;
    registerTerritoryClaimRoutes({
      routes,
      database,
      authSecret,
      ...(mlScorer ? { mlScorer } : {})
    });
    registerTerritoryBoardRoutes({ routes, database, authSecret });
    registerRouteSuggestionRoutes({ routes, database, authSecret });
    registerQuestRecommendationRoutes({ routes, database, authSecret });
    // The provider's bounce and complaint webhook. Unauthenticated but signed,
    // and disabled entirely when no secret is configured.
    registerEmailWebhookRoutes({
      routes,
      database,
      webhookSecret: process.env.EMAIL_WEBHOOK_SECRET?.trim() || undefined
    });

    done();
  });
  return app;
};
