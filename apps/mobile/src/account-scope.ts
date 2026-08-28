import type { AuthSession } from './auth-storage-core';

const tokenSubject = (accessToken: string): string | undefined => {
  const payload = accessToken.split('.')[0];
  if (!payload) return undefined;
  try {
    const subject = JSON.parse(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: string;
    };
    return typeof subject.sub === 'string' && subject.sub.length > 0 ? subject.sub : undefined;
  } catch {
    return undefined;
  }
};

const legacyTokenHashScope = (session: AuthSession): string => {
  let hash = 2_166_136_261;
  for (const character of session.refreshToken)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return `account:${(hash >>> 0).toString(16)}`;
};

/**
 * The server account UUID is the only current local partition key. It is not a credential and
 * remains stable when refresh tokens rotate.
 */
export const accountScopeFor = (session: AuthSession): string => {
  const subject = tokenSubject(session.accessToken);
  if (!subject)
    throw new Error('A server account identifier is required for local activity storage.');
  return subject;
};

/** Legacy local scopes are only used during the one-way upgrade to a server account UUID. */
export const legacyAccountScopesFor = (session: AuthSession): string[] => {
  const subject = tokenSubject(session.accessToken);
  return [
    ...new Set(
      [subject ? `account:${subject}` : undefined, legacyTokenHashScope(session)].filter(Boolean)
    )
  ] as string[];
};
