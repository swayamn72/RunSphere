import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = {
  execAsync: vi.fn(async () => undefined),
  runAsync: vi.fn(async () => ({ changes: 0 })),
  getAllAsync: vi.fn(async () => [])
};
const openDatabaseSync = vi.fn(() => database);

vi.mock('expo-sqlite', () => ({ openDatabaseSync }));

describe('native activity queue adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loads the shared queue factory without resolving back to the native adapter', async () => {
    const { activityQueue } = await import('./activity-queue.native.js');

    expect(openDatabaseSync).toHaveBeenCalledWith('runsphere-activity-queue.db');
    await expect(activityQueue.initialize()).resolves.toBeUndefined();
    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
  });
});
