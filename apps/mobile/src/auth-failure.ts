import { USERNAME_PROBLEM_MESSAGE } from '@runsphere/domain';

type RegistrationField = 'email' | 'password' | 'username' | 'birthDate';

export type AuthFailureKind =
  | 'account-exists'
  | 'username-taken'
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
  'username-taken': 'That username is taken. Try another.',
  'invalid-credentials': 'Email or password was not accepted. Check your details and try again.',
  'invalid-request': 'Check your account details and try again.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  'service-unavailable': 'TURFR is temporarily unavailable. Try again shortly.',
  tls: "TURFR couldn't establish a secure connection. Check your device date and network, then try again.",
  network: "TURFR couldn't reach the service. Check your internet connection and try again.",
  configuration: 'A TURFR API URL is required to sign in.',
  unknown: 'Unable to complete account authentication. Try again.'
};

export class AuthFailure extends Error {
  constructor(
    public readonly kind: AuthFailureKind,
    public readonly status?: number,
    public readonly registrationIssue?: { field: RegistrationField; message: string }
  ) {
    super(registrationIssue?.message ?? messages[kind]);
    this.name = 'AuthFailure';
  }
}

const registrationIssue = (detail: string | undefined): AuthFailure['registrationIssue'] => {
  if (detail === 'You need to be 18 or older to use TURFR.')
    return { field: 'birthDate', message: 'You need to be 18 or older to use TURFR.' };
  const usernameMessage = Object.values(USERNAME_PROBLEM_MESSAGE).find((value) => value === detail);
  if (usernameMessage) return { field: 'username', message: usernameMessage };

  // Use Fastify's field marker only. The rest of its message can contain
  // implementation details and must stay out of the form.
  const field = /^body\/(email|password|dateOfBirth|username)(?:\s|$)/.exec(detail ?? '')?.[1];
  switch (field) {
    case 'email':
      return { field, message: 'Enter a valid email address like you@example.com.' };
    case 'password': {
      const limit = /^body\/password must NOT have (fewer|more) than (\d{1,3}) characters$/.exec(
        detail ?? ''
      );
      if (limit?.[1] === 'fewer')
        return { field, message: `Use at least ${limit[2]} characters for your password.` };
      if (limit?.[1] === 'more') return { field, message: 'Use a shorter password.' };
      return { field, message: 'Try a different password.' };
    }
    case 'dateOfBirth':
      return { field: 'birthDate', message: 'Enter a valid date of birth.' };
    case 'username':
      return { field, message: USERNAME_PROBLEM_MESSAGE.format };
    default:
      return undefined;
  }
};

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
  operation: 'register' | 'login' | 'refresh',
  responseDetail?: string
): AuthFailure => {
  if (status === 409 && operation === 'register') {
    // The registration endpoint sends a distinct message only for usernames.
    const kind =
      responseDetail === 'That username is taken. Try another.'
        ? 'username-taken'
        : 'account-exists';
    return new AuthFailure(kind, status);
  }
  if (status === 401 || status === 403) return new AuthFailure('invalid-credentials', status);
  if (status === 400 || status === 422)
    return new AuthFailure(
      'invalid-request',
      status,
      operation === 'register' ? registrationIssue(responseDetail) : undefined
    );
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
  console.warn('[TURFR auth failure]', {
    operation,
    kind: failure.kind,
    ...(failure.registrationIssue ? { field: failure.registrationIssue.field } : {}),
    ...(failure.status === undefined ? {} : { status: failure.status })
  });
};
