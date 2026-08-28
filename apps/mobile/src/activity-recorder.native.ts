import * as SQLite from 'expo-sqlite';
import { createActivityRecorder } from './activity-recorder-core';

const database = SQLite.openDatabaseSync('runsphere-activities.db');
export const activityRecorder = createActivityRecorder(database);
