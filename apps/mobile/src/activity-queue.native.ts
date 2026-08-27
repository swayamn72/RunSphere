import * as SQLite from 'expo-sqlite';
import { createActivityQueue } from './activity-queue';

const database = SQLite.openDatabaseSync('runsphere-activity-queue.db');

/**
 * Durable foreground queue only. Background recording and upload scheduling are intentionally
 * out of scope for M1.
 */
export const activityQueue = createActivityQueue(database);
