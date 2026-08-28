import * as SQLite from 'expo-sqlite';
import { createActivityRecorder } from './activity-recorder-core';
import { prepareEncryptedDatabase } from './encrypted-sqlite.native';

const database = SQLite.openDatabaseSync('runsphere-activities.db');
const encryptionKeyName = 'runsphere.activities.sqlcipher-key.v1';
const recorder = createActivityRecorder(database);

/**
 * The activity key stays in Android Keystore-backed SecureStore, never in SQLite or app config.
 * Legacy scope re-keying is an in-place row update and must run before any future database copy.
 */
let initialization: Promise<void> | undefined;

export const activityRecorder = {
  ...recorder,
  initialize(): Promise<void> {
    initialization ??= prepareEncryptedDatabase(database, encryptionKeyName)
      .then(() => recorder.initialize())
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
    return initialization;
  }
};
