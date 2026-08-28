import type { AuthSession } from './auth-storage-core';

/** Returns a non-secret local partition key; do not persist raw bearer credentials in SQLite. */
export const accountScopeFor = (session: AuthSession): string => {
  const payload = session.accessToken.split('.')[1];
  if (payload) {
    try {
      const subject = JSON.parse(
        globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      ) as { sub?: string };
      if (subject.sub) return `account:${subject.sub}`;
    } catch {
      // Opaque token: retain a deterministic local partition without storing credentials.
    }
  }
  let hash = 2_166_136_261;
  for (const character of session.refreshToken)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return `account:${(hash >>> 0).toString(16)}`;
};
