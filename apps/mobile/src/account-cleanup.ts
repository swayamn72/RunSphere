import type { ActivityQueue } from './activity-queue';
import type { AuthStorage } from './auth-storage';

/** Clears all data scoped to the signed-in account on logout or account deletion. */
export const clearAccountData = async (
  queue: Pick<ActivityQueue, 'clear'>,
  auth: Pick<AuthStorage, 'clear'>
): Promise<void> => {
  await Promise.all([queue.clear(), auth.clear()]);
};
