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

/**
 * Email links carry their one-time token in the query string
 * (`/reset-password?token=…`), and Fastify logs every request's URL. Path-based
 * redaction can't reach inside a URL string, so the request serializer runs
 * URLs through this before they are written.
 */
export const redactUrlSecrets = (url: string): string =>
  url.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');

/** The parts of a Fastify request that its default `req` log line uses. */
interface LoggedRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remotePort?: number | undefined } | null;
}

/** Fastify's default `req` log fields, with secrets taken out of the URL. */
export const requestLogSerializer = (request: LoggedRequest) => {
  const version = request.headers?.['accept-version'];
  const remotePort = request.socket?.remotePort;
  return {
    method: request.method,
    url: redactUrlSecrets(request.url),
    ...(typeof version === 'string' ? { version } : {}),
    ...(request.host === undefined ? {} : { host: request.host }),
    ...(request.ip === undefined ? {} : { remoteAddress: request.ip }),
    ...(remotePort === undefined ? {} : { remotePort })
  };
};

export interface ApiConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  staffReviewAccountIds: readonly string[];
  metricsCollectorToken?: string;
  /**
   * Who runs RunSphere and who handles complaints, shown on the legal pages
   * (IT Rules 2021 grievance officer; DPDP contact). Unset values show as "to be
   * named", so set the operator, officer, host and courts in production. The
   * email provider is named only once email is configured.
   */
  legalContact?: LegalContact;
}

export interface LegalContact {
  operatorName?: string;
  grievanceOfficerName?: string;
  grievanceOfficerEmail?: string;
  /** Named in the privacy notice's "Who processes data for us" (DPDP s.8(2)). */
  hostingProvider?: string;
  emailProvider?: string;
  /** The courts named in the terms' "Law and disputes", e.g. "the courts at Mumbai". */
  courts?: string;
}

const LEGAL_CONTACT_ENV: Readonly<Record<keyof LegalContact, string>> = {
  operatorName: 'LEGAL_OPERATOR_NAME',
  grievanceOfficerName: 'GRIEVANCE_OFFICER_NAME',
  grievanceOfficerEmail: 'GRIEVANCE_OFFICER_EMAIL',
  hostingProvider: 'LEGAL_HOSTING_PROVIDER',
  emailProvider: 'LEGAL_EMAIL_PROVIDER',
  courts: 'LEGAL_COURTS'
};

const legalContactFrom = (environment: NodeJS.ProcessEnv): LegalContact | undefined => {
  const contact: LegalContact = {};
  for (const [field, name] of Object.entries(LEGAL_CONTACT_ENV) as [keyof LegalContact, string][]) {
    const value = environment[name]?.trim();
    if (value) contact[field] = value;
  }
  return Object.keys(contact).length > 0 ? contact : undefined;
};

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
  const legalContact = legalContactFrom(environment);

  return {
    host: environment.HOST ?? '0.0.0.0',
    port,
    allowedOrigins,
    staffReviewAccountIds,
    ...(metricsCollectorToken ? { metricsCollectorToken } : {}),
    ...(legalContact ? { legalContact } : {})
  };
};

export const apiConfig = loadApiConfig(process.env);
