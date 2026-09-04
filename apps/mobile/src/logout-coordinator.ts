import type { ActivityQueue } from './activity-queue-core';
import type { AuthStorage } from './auth-storage-core';

export interface LogoutApi {
  logout(): Promise<void>;
}

export interface LogoutDependencies {
  api: LogoutApi;
  auth: Pick<AuthStorage, 'clear'>;
  queue: Pick<ActivityQueue, 'clear'>;
  recorder?: { clear(): Promise<void> };
  /** Revokes this installation's push address; absent until push is registered. */
  push?: { revoke(): Promise<void> };
}

/**
 * Revokes the refresh token when possible, then clears local account state before allowing the UI
 * to reset. A remote/network failure must never strand a user in a locally authenticated session.
 */
export const coordinateLogout = async ({
  api,
  auth,
  queue,
  recorder,
  push
}: LogoutDependencies): Promise<void> => {
  // Revoke the push address while the session can still authenticate the call;
  // after `auth.clear()` there is no credential left to revoke it with.
  await push?.revoke();
  try {
    await api.logout();
  } catch {
    // Remote logout is best-effort. Local credentials still need to be removed.
  }

  await Promise.all([auth.clear(), queue.clear(), recorder?.clear()]);
};
