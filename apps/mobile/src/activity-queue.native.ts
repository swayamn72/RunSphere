import * as SQLite from 'expo-sqlite';
import { createActivityQueue } from './activity-queue-core';
import { prepareEncryptedDatabase } from './encrypted-sqlite.native';

const database = SQLite.openDatabaseSync('runsphere-activity-queue.db');
const queue = createActivityQueue(database);

/** Durable metadata queue protected by its own Keystore-backed SQLCipher key. */
let initialization: Promise<void> | undefined;

export const activityQueue = {
  ...queue,
  initialize(): Promise<void> {
    initialization ??= prepareEncryptedDatabase(
      database,
      'runsphere.activity-queue.sqlcipher-key.v1'
    )
      .then(() => queue.initialize())
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
    return initialization;
  }
};
