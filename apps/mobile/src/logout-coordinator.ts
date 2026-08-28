import type { ActivityQueue } from './activity-queue-core';
import type { AuthStorage } from './auth-storage-core';

export interface LogoutApi {
  logout(): Promise<void>;
}

export interface LogoutDependencies {
  api: LogoutApi;
  auth: Pick<AuthStorage, 'clear'>;
  queue: Pick<ActivityQueue, 'clear'>;
}

/**
 * Revokes the refresh token when possible, then clears local account state before allowing the UI
 * to reset. A remote/network failure must never strand a user in a locally authenticated session.
 */
export const coordinateLogout = async ({ api, auth, queue }: LogoutDependencies): Promise<void> => {
  try {
    await api.logout();
  } catch {
    // Remote logout is best-effort. Local credentials still need to be removed.
  }

  await Promise.all([auth.clear(), queue.clear()]);
};
