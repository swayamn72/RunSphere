import type { ActivityQueue } from './activity-queue-core';
import type { AuthStorage } from './auth-storage-core';

/** Clears all data scoped to the signed-in account on logout or account deletion. */
export const clearAccountData = async (
  queue: Pick<ActivityQueue, 'clear'>,
  auth: Pick<AuthStorage, 'clear'>,
  recorder?: { clear(): Promise<void> }
): Promise<void> => {
  await Promise.all([queue.clear(), auth.clear(), recorder?.clear()]);
};
