import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = {
  execAsync: vi.fn(async () => undefined),
  runAsync: vi.fn(async () => ({ changes: 0 })),
  getAllAsync: vi.fn(async () => [])
};
const openDatabaseSync = vi.fn(() => database);
const prepareEncryptedDatabase = vi.fn(async () => undefined);

vi.mock('expo-sqlite', () => ({ openDatabaseSync }));
vi.mock('./encrypted-sqlite.native', () => ({ prepareEncryptedDatabase }));

describe('native activity queue adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('prepares its separate SQLCipher key before loading the shared queue schema', async () => {
    const { activityQueue } = await import('./activity-queue.native.js');

    expect(openDatabaseSync).toHaveBeenCalledWith('runsphere-activity-queue.db');
    await expect(activityQueue.initialize()).resolves.toBeUndefined();
    expect(prepareEncryptedDatabase).toHaveBeenCalledWith(
      database,
      'runsphere.activity-queue.sqlcipher-key.v1'
    );
    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
  });
});
