import * as SQLite from 'expo-sqlite';
import { createActivityQueue } from './activity-queue-core';
import { prepareEncryptedDatabase } from './encrypted-sqlite.native';

const database = SQLite.openDatabaseSync('runsphere-activity-queue.db');
const queue = createActivityQueue(database);

/** Durable metadata queue protected by its own Keystore-backed SQLCipher key. */
export const activityQueue = {
  ...queue,
  async initialize(): Promise<void> {
    await prepareEncryptedDatabase(database, 'runsphere.activity-queue.sqlcipher-key.v1');
    await queue.initialize();
  }
};
