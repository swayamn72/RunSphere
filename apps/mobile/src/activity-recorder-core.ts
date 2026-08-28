export type MovementType = 'walk' | 'run' | 'hike';
export type RecordingState =
  | 'prepare'
  | 'acquiring'
  | 'active'
  | 'paused'
  | 'resumed'
  | 'finishing'
  | 'completed-local'
  | 'queued'
  | 'syncing'
  | 'processed'
  | 'failed'
  | 'discarded';

export interface LocationSample {
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
}

export interface ActivitySession {
  id: string;
  accountId: string;
  movementType: MovementType;
  state: RecordingState;
  startedAt: string;
  updatedAt: string;
  pausedAt?: string | undefined;
  completedAt?: string | undefined;
  durationSeconds: number;
  distanceMeters: number;
  acceptedSamples: number;
  lastHeartbeatAt: string;
}

export interface RecorderDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const ACTIVITY_RECORDER_SCHEMA_VERSION = 4;
export const MAX_SAMPLE_ACCURACY_METERS = 50;
export const MAX_SEGMENT_SPEED_METERS_PER_SECOND = 12;

export const activityRecorderSchema = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS recorded_activities (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('walk', 'run', 'hike')),
    state TEXT NOT NULL CHECK (state IN ('prepare', 'acquiring', 'active', 'paused', 'resumed', 'finishing', 'completed-local', 'queued', 'syncing', 'processed', 'failed', 'discarded')),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paused_at TEXT,
    completed_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    distance_meters REAL NOT NULL DEFAULT 0,
    accepted_samples INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_location_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL REFERENCES recorded_activities(id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    altitude REAL
  );
  CREATE INDEX IF NOT EXISTS activity_samples_by_activity ON activity_location_samples(activity_id, recorded_at);
  CREATE INDEX IF NOT EXISTS activities_by_account_state ON recorded_activities(account_id, state, updated_at);
  PRAGMA user_version = ${ACTIVITY_RECORDER_SCHEMA_VERSION};
`;

const rowToSession = (row: Record<string, unknown>): ActivitySession => ({
  id: row.id as string,
  accountId: row.accountId as string,
  movementType: row.movementType as MovementType,
  state: row.state as RecordingState,
  startedAt: row.startedAt as string,
  updatedAt: row.updatedAt as string,
  pausedAt: (row.pausedAt as string | null) ?? undefined,
  completedAt: (row.completedAt as string | null) ?? undefined,
  durationSeconds: Number(row.durationSeconds),
  distanceMeters: Number(row.distanceMeters),
  acceptedSamples: Number(row.acceptedSamples),
  lastHeartbeatAt: row.lastHeartbeatAt as string
});

const distanceBetween = (a: LocationSample, b: LocationSample): number => {
  const radius = 6_371_000;
  const radians = Math.PI / 180;
  const latDelta = (b.latitude - a.latitude) * radians;
  const lonDelta = (b.longitude - a.longitude) * radians;
  const x =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lonDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

export const isUsableSample = (sample: LocationSample): boolean =>
  sample.accuracy !== null && sample.accuracy >= 0 && sample.accuracy <= MAX_SAMPLE_ACCURACY_METERS;

const canTransition = (from: RecordingState, to: RecordingState): boolean => {
  const transitions: Record<RecordingState, readonly RecordingState[]> = {
    prepare: ['acquiring', 'discarded'],
    acquiring: ['active', 'failed', 'discarded'],
    active: ['paused', 'finishing', 'failed'],
    paused: ['resumed', 'finishing', 'discarded'],
    resumed: ['active', 'paused', 'finishing', 'failed'],
    finishing: ['completed-local', 'failed'],
    'completed-local': ['queued', 'discarded'],
    queued: ['syncing', 'discarded'],
    syncing: ['processed', 'failed'],
    processed: [],
    failed: ['queued', 'discarded'],
    discarded: []
  };
  return transitions[from].includes(to);
};

export const createActivityRecorder = (database: RecorderDatabase) => ({
  async initialize(): Promise<void> {
    await database.execAsync(activityRecorderSchema);
  },
  async create(
    session: Omit<ActivitySession, 'durationSeconds' | 'distanceMeters' | 'acceptedSamples'>
  ): Promise<void> {
    await database.runAsync(
      `INSERT INTO recorded_activities (id, account_id, movement_type, state, started_at, updated_at, paused_at, completed_at, duration_seconds, distance_meters, accepted_samples, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      session.id,
      session.accountId,
      session.movementType,
      session.state,
      session.startedAt,
      session.updatedAt,
      session.pausedAt ?? null,
      session.completedAt ?? null,
      session.lastHeartbeatAt
    );
  },
  async get(id: string, accountId: string): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT id, account_id AS accountId, movement_type AS movementType, state, started_at AS startedAt, updated_at AS updatedAt,
       paused_at AS pausedAt, completed_at AS completedAt, duration_seconds AS durationSeconds, distance_meters AS distanceMeters,
       accepted_samples AS acceptedSamples, last_heartbeat_at AS lastHeartbeatAt FROM recorded_activities WHERE id = ? AND account_id = ?`,
      id,
      accountId
    );
    return row ? rowToSession(row) : undefined;
  },
  async recover(accountId: string): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT id, account_id AS accountId, movement_type AS movementType, state, started_at AS startedAt, updated_at AS updatedAt,
       paused_at AS pausedAt, completed_at AS completedAt, duration_seconds AS durationSeconds, distance_meters AS distanceMeters,
       accepted_samples AS acceptedSamples, last_heartbeat_at AS lastHeartbeatAt FROM recorded_activities
       WHERE account_id = ? AND state IN ('prepare', 'acquiring', 'active', 'paused', 'resumed', 'finishing') ORDER BY updated_at DESC LIMIT 1`,
      accountId
    );
    return row ? rowToSession(row) : undefined;
  },
  async recoverAnyActive(): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT id, account_id AS accountId, movement_type AS movementType, state, started_at AS startedAt, updated_at AS updatedAt,
       paused_at AS pausedAt, completed_at AS completedAt, duration_seconds AS durationSeconds, distance_meters AS distanceMeters,
       accepted_samples AS acceptedSamples, last_heartbeat_at AS lastHeartbeatAt FROM recorded_activities
       WHERE state IN ('active', 'resumed') ORDER BY updated_at DESC LIMIT 1`
    );
    return row ? rowToSession(row) : undefined;
  },
  async transition(
    id: string,
    accountId: string,
    from: RecordingState,
    to: RecordingState,
    at: string
  ): Promise<boolean> {
    if (!canTransition(from, to)) throw new Error(`Invalid recording transition: ${from} -> ${to}`);
    const result = await database.runAsync(
      `UPDATE recorded_activities SET state = ?, updated_at = ?, paused_at = CASE WHEN ? = 'paused' THEN ? ELSE paused_at END,
       completed_at = CASE WHEN ? = 'completed-local' THEN ? ELSE completed_at END WHERE id = ? AND account_id = ? AND state = ?`,
      to,
      at,
      to,
      at,
      to,
      at,
      id,
      accountId,
      from
    );
    return result.changes === 1;
  },
  async heartbeat(
    id: string,
    accountId: string,
    at: string,
    durationSeconds: number
  ): Promise<void> {
    await database.runAsync(
      'UPDATE recorded_activities SET updated_at = ?, last_heartbeat_at = ?, duration_seconds = ? WHERE id = ? AND account_id = ?',
      at,
      at,
      durationSeconds,
      id,
      accountId
    );
  },
  async appendSample(id: string, accountId: string, sample: LocationSample): Promise<boolean> {
    if (!isUsableSample(sample)) return false;
    const session = await this.get(id, accountId);
    if (!session || !['active', 'resumed'].includes(session.state)) return false;
    const previous = await database.getFirstAsync<LocationSample>(
      'SELECT recorded_at AS recordedAt, latitude, longitude, accuracy, altitude FROM activity_location_samples WHERE activity_id = ? ORDER BY recorded_at DESC LIMIT 1',
      id
    );
    const segment = previous ? distanceBetween(previous, sample) : 0;
    const elapsed = previous
      ? Math.max(1, (Date.parse(sample.recordedAt) - Date.parse(previous.recordedAt)) / 1000)
      : 1;
    if (previous && segment / elapsed > MAX_SEGMENT_SPEED_METERS_PER_SECOND) return false;
    await database.runAsync(
      'INSERT INTO activity_location_samples (activity_id, recorded_at, latitude, longitude, accuracy, altitude) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      sample.recordedAt,
      sample.latitude,
      sample.longitude,
      sample.accuracy,
      sample.altitude
    );
    await database.runAsync(
      'UPDATE recorded_activities SET distance_meters = distance_meters + ?, accepted_samples = accepted_samples + 1, updated_at = ?, last_heartbeat_at = ? WHERE id = ? AND account_id = ?',
      segment,
      sample.recordedAt,
      sample.recordedAt,
      sample.recordedAt,
      id,
      accountId
    );
    return true;
  },
  async clearAccount(accountId: string): Promise<void> {
    await database.runAsync('DELETE FROM recorded_activities WHERE account_id = ?', accountId);
  }
});

export type ActivityRecorder = ReturnType<typeof createActivityRecorder>;
