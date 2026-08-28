export const productConfig = {
  name: 'RunSphere',
  market: 'Mumbai Metropolitan Region',
  launchPlatforms: ['android'] as const,
  iosRelease: 'v1.1',
  monthlyInfraBudgetInr: 3000
} as const;

const defaultAllowedOrigins = ['http://localhost:4173'];

/**
 * Shared Pino paths for sensitive HTTP metadata. Request bodies are not logged
 * wholesale; these paths protect explicitly logged request or response fields.
 */
export const pinoRedactionPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'authorization',
  'cookie',
  'setCookie',
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'email',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.password',
  'req.body.email',
  'req.body.coordinates',
  'req.body.geometry.coordinates',
  'req.body.points.*.latitude',
  'req.body.points.*.longitude',
  'req.body.polyline',
  'req.body.placeId',
  'req.body.placeIds',
  'req.body.*.token',
  'req.body.*.accessToken',
  'req.body.*.refreshToken',
  'req.body.*.password',
  'req.body.*.email',
  'req.body.*.coordinates',
  'req.body.*.geometry.coordinates',
  'req.body.*.points.*.latitude',
  'req.body.*.points.*.longitude',
  'req.body.*.polyline',
  'req.body.*.placeId',
  'req.body.*.placeIds',
  'res.body.token',
  'res.body.accessToken',
  'res.body.refreshToken',
  'res.body.password',
  'res.body.email',
  'res.body.coordinates',
  'res.body.geometry.coordinates',
  'res.body.points.*.latitude',
  'res.body.points.*.longitude',
  'res.body.polyline',
  'res.body.placeId',
  'res.body.placeIds'
] as const;

export interface ApiConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  staffReviewAccountIds: readonly string[];
  metricsCollectorToken?: string;
}

export const loadApiConfig = (environment: NodeJS.ProcessEnv): ApiConfig => {
  const port = Number(environment.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const allowedOrigins = (environment.CORS_ALLOWED_ORIGINS ?? defaultAllowedOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !URL.canParse(origin))) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain one or more valid origins.');
  }

  const staffReviewAccountIds = (environment.STAFF_REVIEW_ACCOUNT_IDS ?? '')
    .split(',')
    .map((accountId) => accountId.trim())
    .filter(Boolean);
  const metricsCollectorToken = environment.METRICS_COLLECTOR_TOKEN?.trim() || undefined;

  return {
    host: environment.HOST ?? '0.0.0.0',
    port,
    allowedOrigins,
    staffReviewAccountIds,
    ...(metricsCollectorToken ? { metricsCollectorToken } : {})
  };
};

export const apiConfig = loadApiConfig(process.env);
