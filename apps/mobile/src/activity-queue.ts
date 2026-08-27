export const ACTIVITY_QUEUE_SCHEMA_VERSION = 3;

/**
 * Metadata-only activity work item. Upload is deliberately deferred: this queue stores no GPS
 * points, routes, coordinates, or exact traces, and it has no upload worker.
 */
export interface QueuedActivity {
  id: string;
  movementType: 'walk' | 'run' | 'hike';
  createdAt: string;
  status: 'ready';
}

export interface ActivityQueueDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const activityQueueSchema = `
  CREATE TABLE IF NOT EXISTS activity_queue (
    id TEXT PRIMARY KEY NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('walk', 'run', 'hike')),
    created_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status = 'ready')
  );
  PRAGMA user_version = ${ACTIVITY_QUEUE_SCHEMA_VERSION};
`;

export const createActivityQueue = (database: ActivityQueueDatabase) => ({
  async initialize(): Promise<void> {
    await database.execAsync(activityQueueSchema);
  },

  async enqueue(activity: QueuedActivity): Promise<boolean> {
    const result = await database.runAsync(
      'INSERT OR IGNORE INTO activity_queue (id, movement_type, created_at, status) VALUES (?, ?, ?, ?)',
      activity.id,
      activity.movementType,
      activity.createdAt,
      activity.status
    );
    return result.changes === 1;
  },

  async list(): Promise<QueuedActivity[]> {
    return database.getAllAsync<QueuedActivity>(
      'SELECT id, movement_type AS movementType, created_at AS createdAt, status FROM activity_queue ORDER BY created_at ASC'
    );
  },

  async remove(id: string): Promise<void> {
    await database.runAsync('DELETE FROM activity_queue WHERE id = ?', id);
  },

  async clear(): Promise<void> {
    await database.runAsync('DELETE FROM activity_queue');
  }
});

export type ActivityQueue = ReturnType<typeof createActivityQueue>;
