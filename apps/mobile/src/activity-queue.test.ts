import { describe, expect, it } from 'vitest';
import { createActivityQueue, type ActivityQueueDatabase } from './activity-queue-core.js';

class MemoryDatabase implements ActivityQueueDatabase {
  readonly rows = new Map<
    string,
    { id: string; movementType: 'walk' | 'run'; createdAt: string; status: 'ready' }
  >();
  version = 0;

  async execAsync(sql: string): Promise<void> {
    this.version = Number(sql.match(/user_version = (\d+)/)?.[1] ?? 0);
  }

  async runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.startsWith('INSERT')) {
      const [id, movementType, createdAt, status] = params as [
        string,
        'walk' | 'run',
        string,
        'ready'
      ];
      if (this.rows.has(id)) return { changes: 0 };
      this.rows.set(id, { id, movementType, createdAt, status });
      return { changes: 1 };
    }
    if (sql === 'DELETE FROM activity_queue') {
      const changes = this.rows.size;
      this.rows.clear();
      return { changes };
    }
    this.rows.delete(params[0] as string);
    return { changes: 1 };
  }

  async getAllAsync<T>(): Promise<T[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as T[];
  }
}

describe('activity queue', () => {
  it('initializes versioned metadata-only storage and ignores duplicate stable IDs', async () => {
    const database = new MemoryDatabase();
    const queue = createActivityQueue(database);
    await queue.initialize();
    expect(database.version).toBe(3);

    const activity = {
      id: 'activity-1',
      movementType: 'hike' as const,
      createdAt: '2026-08-27T00:00:00Z',
      status: 'ready' as const
    };
    await expect(queue.enqueue(activity)).resolves.toBe(true);
    await expect(queue.enqueue(activity)).resolves.toBe(false);
    await expect(queue.list()).resolves.toEqual([activity]);
  });

  it('wipes the account-scoped queue on demand', async () => {
    const queue = createActivityQueue(new MemoryDatabase());
    await queue.enqueue({
      id: 'activity-1',
      movementType: 'run',
      createdAt: '2026-08-27T00:00:00Z',
      status: 'ready'
    });
    await queue.clear();
    await expect(queue.list()).resolves.toEqual([]);
  });
});
