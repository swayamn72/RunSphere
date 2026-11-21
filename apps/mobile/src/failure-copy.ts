import { ApiFailure } from './api-client';
import { AuthFailure } from './auth-failure';

/**
 * Error and empty-state copy (UX.7, `docs/voice.md` rules 5 and 6).
 *
 * Every failure a runner can see ends with what to do next or with the
 * reassurance that nothing was lost, and none of it carries a status code,
 * a request path or exception text. `failureMessage` is the one place a
 * caught error becomes words on screen.
 */
export const FAILURE_COPY = {
  offline: "You're offline. Your runs are saved and sync when you're back.",
  sessionEnded: 'You were signed out. Sign in again to carry on.',
  unavailable: "RunSphere isn't responding right now. Try again in a minute.",
  rateLimited: 'Lots of tries just now. Wait a minute, then try again.',
  notFound: "That's no longer here. Pull to refresh.",
  generic: 'Something went wrong. Nothing was lost; try again.',
  offlineRun: "Offline. You can still run; we'll sync when you're back.",
  noQuests: 'Start a free run; quests appear as areas are mapped.'
} as const;

/**
 * Statuses whose `message` the API writes for people: a moderation decision
 * (403), a conflict it explains (409) and a rule it explains (422). A 400 is
 * schema validation text ("body/lengthDays must be …") and 5xx or a
 * fallback reads "Request to /v1/… failed (500)", so neither is shown.
 */
const HUMAN_STATUSES = new Set([403, 409, 422]);

const looksTechnical = (message: string): boolean =>
  /\/v1\/|\(\d{3}\)|\bbody\/|must match|must be equal|Error:|undefined|null/i.test(message);

export const failureMessage = (error: unknown, fallback: string = FAILURE_COPY.generic): string => {
  if (error instanceof AuthFailure) {
    if (error.kind === 'network' || error.kind === 'tls') return FAILURE_COPY.offline;
    if (error.kind === 'invalid-credentials') return FAILURE_COPY.sessionEnded;
    if (error.kind === 'rate-limited') return FAILURE_COPY.rateLimited;
    if (error.kind === 'service-unavailable') return FAILURE_COPY.unavailable;
    return fallback;
  }
  if (error instanceof ApiFailure) {
    if (error.status === 401) return FAILURE_COPY.sessionEnded;
    if (error.status === 404) return FAILURE_COPY.notFound;
    if (error.status === 429) return FAILURE_COPY.rateLimited;
    if (error.status >= 500) return FAILURE_COPY.unavailable;
    if (HUMAN_STATUSES.has(error.status) && error.message && !looksTechnical(error.message))
      return error.message;
    return fallback;
  }
  // fetch's own `TypeError: Network request failed` and anything else thrown.
  if (error instanceof TypeError && /network/i.test(error.message)) return FAILURE_COPY.offline;
  return fallback;
};
