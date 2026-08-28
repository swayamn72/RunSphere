export type AuthFailureKind =
  | 'account-exists'
  | 'invalid-credentials'
  | 'invalid-request'
  | 'rate-limited'
  | 'service-unavailable'
  | 'tls'
  | 'network'
  | 'configuration'
  | 'unknown';

const messages: Record<AuthFailureKind, string> = {
  'account-exists':
    'An account may already exist for this email. Sign in instead, or use a different email.',
  'invalid-credentials': 'Email or password was not accepted. Check your details and try again.',
  'invalid-request': 'Check your account details and try again.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  'service-unavailable': 'RunSphere is temporarily unavailable. Try again shortly.',
  tls: "RunSphere couldn't establish a secure connection. Check your device date and network, then try again.",
  network: "RunSphere couldn't reach the service. Check your internet connection and try again.",
  configuration: 'A RunSphere API URL is required to sign in.',
  unknown: 'Unable to complete account authentication. Try again.'
};

export class AuthFailure extends Error {
  constructor(
    public readonly kind: AuthFailureKind,
    public readonly status?: number
  ) {
    super(messages[kind]);
    this.name = 'AuthFailure';
  }
}

const errorText = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = 'cause' in error ? String(error.cause) : '';
  const code = 'code' in error ? String(error.code) : '';
  return `${error.name} ${error.message} ${code} ${cause}`;
};

export const classifyTransportFailure = (error: unknown): AuthFailure => {
  const details = errorText(error);
  if (/certificate|certpath|ssl|tls|handshake|trust anchor|hostname verification/i.test(details)) {
    return new AuthFailure('tls');
  }
  return new AuthFailure('network');
};

export const classifyAuthResponse = (
  status: number,
  operation: 'register' | 'login' | 'refresh'
): AuthFailure => {
  if (status === 409 && operation === 'register') return new AuthFailure('account-exists', status);
  if (status === 401 || status === 403) return new AuthFailure('invalid-credentials', status);
  if (status === 400 || status === 422) return new AuthFailure('invalid-request', status);
  if (status === 429) return new AuthFailure('rate-limited', status);
  if (status >= 500) return new AuthFailure('service-unavailable', status);
  return new AuthFailure('unknown', status);
};

export const reportAuthFailure = (
  operation: 'register' | 'login' | 'refresh',
  failure: AuthFailure
): void => {
  const isDevelopmentBuild =
    typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (!isDevelopmentBuild) return;
  // Do not include the request URL, email, password, tokens, or response body here.
  console.warn('[RunSphere auth failure]', {
    operation,
    kind: failure.kind,
    ...(failure.status === undefined ? {} : { status: failure.status })
  });
};
