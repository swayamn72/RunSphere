import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RECORDER_SCHEMA_VERSION,
  createActivityRecorder,
  type ActivitySession,
  type RecorderDatabase
} from './activity-recorder-core.js';

class MemoryDatabase implements RecorderDatabase {
  session: ActivitySession | undefined;
  samples: Array<{
    activityId: string;
    recordedAt: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number | null;
  }> = [];
  schema = '';
  async execAsync(sql: string) {
    this.schema = sql;
  }
  async runAsync(sql: string, ...params: unknown[]) {
    if (sql.startsWith('INSERT INTO recorded_activities')) {
      const [
        id,
        accountId,
        movementType,
        state,
        startedAt,
        updatedAt,
        pausedAt,
        completedAt,
        lastHeartbeatAt
      ] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
        string | undefined,
        string | undefined,
        string
      ];
      this.session = {
        id,
        accountId,
        movementType: movementType as ActivitySession['movementType'],
        state: state as ActivitySession['state'],
        startedAt,
        updatedAt,
        pausedAt: pausedAt || undefined,
        completedAt: completedAt || undefined,
        durationSeconds: 0,
        distanceMeters: 0,
        acceptedSamples: 0,
        lastHeartbeatAt
      };
    } else if (sql.startsWith('INSERT OR IGNORE INTO activity_location_samples')) {
      const [activityId, recordedAt, latitude, longitude, accuracy, altitude] = params as [
        string,
        string,
        number,
        number,
        number | null,
        number | null
      ];
      this.samples.push({ activityId, recordedAt, latitude, longitude, accuracy, altitude });
    } else if (sql.includes('SET distance_meters')) {
      this.session!.distanceMeters += params[0] as number;
      this.session!.acceptedSamples++;
      this.session!.updatedAt = params[1] as string;
    } else if (sql.includes('SET state')) {
      if (!this.session || this.session.state !== params[8]) return { changes: 0 };
      this.session.state = params[0] as ActivitySession['state'];
      this.session.updatedAt = params[1] as string;
    } else if (sql.includes('SET updated_at')) {
      this.session!.durationSeconds = params[2] as number;
    } else if (sql.startsWith('DELETE')) this.session = undefined;
    return { changes: 1 };
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    if (sql.includes('activity_location_samples')) return (this.samples.at(-1) ?? null) as T | null;
    const requestedAccount = sql.includes('WHERE id = ?') ? params[1] : params[0];
    if (sql.includes('account_id') && requestedAccount !== this.session?.accountId) return null;
    return (this.session ?? null) as T | null;
  }
  async getAllAsync<T>(): Promise<T[]> {
    return [];
  }
}

const base = {
  id: 'activity-1',
  accountId: 'account-a',
  movementType: 'walk' as const,
  state: 'prepare' as const,
  startedAt: '2026-08-28T10:00:00Z',
  updatedAt: '2026-08-28T10:00:00Z',
  lastHeartbeatAt: '2026-08-28T10:00:00Z'
};

describe('activity recorder', () => {
  it('creates WAL-backed versioned account-scoped recording storage', async () => {
    const database = new MemoryDatabase();
    const recorder = createActivityRecorder(database);
    await recorder.initialize();
    expect(database.schema).toContain('journal_mode = WAL');
    expect(database.schema).toContain(`user_version = ${ACTIVITY_RECORDER_SCHEMA_VERSION}`);
    await recorder.create(base);
    await expect(recorder.recover('account-a')).resolves.toMatchObject({ id: 'activity-1' });
    await expect(recorder.recover('account-b')).resolves.toBeUndefined();
  });
  it('filters inaccurate and impossible samples before computing provisional distance', async () => {
    const database = new MemoryDatabase();
    const recorder = createActivityRecorder(database);
    await recorder.create(base);
    await recorder.transition(base.id, base.accountId, 'prepare', 'acquiring', base.startedAt);
    await recorder.transition(base.id, base.accountId, 'acquiring', 'active', base.startedAt);
    await expect(
      recorder.appendSample(base.id, base.accountId, {
        recordedAt: base.startedAt,
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 80,
        altitude: null
      })
    ).resolves.toBe(false);
    await recorder.appendSample(base.id, base.accountId, {
      recordedAt: base.startedAt,
      latitude: 19.076,
      longitude: 72.8777,
      accuracy: 8,
      altitude: 10
    });
    const duplicate = {
      recordedAt: '2026-08-28T10:01:00Z',
      latitude: 19.0762,
      longitude: 72.8777,
      accuracy: 8,
      altitude: 11
    };
    await recorder.appendSample(base.id, base.accountId, duplicate);
    // Foreground watcher and Android TaskManager may overlap during an app transition; a stable sample key must not inflate distance.
    await expect(recorder.appendSample(base.id, base.accountId, duplicate)).resolves.toBe(false);
    await expect(recorder.get(base.id, base.accountId)).resolves.toMatchObject({
      acceptedSamples: 2,
      distanceMeters: expect.any(Number)
    });
  });
  it('accepts only durable lifecycle transitions', async () => {
    const recorder = createActivityRecorder(new MemoryDatabase());
    await recorder.create(base);
    await expect(
      recorder.transition(base.id, base.accountId, 'prepare', 'active', base.startedAt)
    ).rejects.toThrow('Invalid recording transition');
  });
});
