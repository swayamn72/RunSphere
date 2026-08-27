export const productConfig = {
  name: 'RunSphere',
  market: 'Mumbai Metropolitan Region',
  launchPlatforms: ['android'] as const,
  iosRelease: 'v1.1',
  monthlyInfraBudgetInr: 3000
} as const;

const defaultAllowedOrigins = ['http://localhost:4173'];

export interface ApiConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
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

  return {
    host: environment.HOST ?? '0.0.0.0',
    port,
    allowedOrigins
  };
};

export const apiConfig = loadApiConfig(process.env);
