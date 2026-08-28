import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = {
  execAsync: vi.fn(async () => undefined),
  runAsync: vi.fn(async () => ({ changes: 0 })),
  getFirstAsync: vi.fn(async () => ({ user_version: 0 })),
  getAllAsync: vi.fn(async () => [])
};
const openDatabaseSync = vi.fn(() => database);
const prepareEncryptedDatabase = vi.fn(async () => undefined);

vi.mock('expo-sqlite', () => ({ openDatabaseSync }));
vi.mock('./encrypted-sqlite.native', () => ({ prepareEncryptedDatabase }));

describe('native encrypted activity recorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('prepares SQLCipher before applying the recorder schema', async () => {
    const { activityRecorder } = await import('./activity-recorder.native.js');
    await activityRecorder.initialize();

    expect(openDatabaseSync).toHaveBeenCalledWith('runsphere-activities.db');
    expect(prepareEncryptedDatabase).toHaveBeenCalledWith(
      database,
      'runsphere.activities.sqlcipher-key.v1'
    );
    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
  });
});
