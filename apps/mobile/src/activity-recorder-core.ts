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

export type SampleDisposition =
  'usable' | 'weak-accuracy' | 'gap-anchor' | 'resume-anchor' | 'impossible-segment';

export interface RecordedLocationSample extends LocationSample {
  disposition: SampleDisposition;
  segmentBreak: boolean;
}

export interface ActivitySession {
  id: string;
  accountId: string;
  movementType: MovementType;
  state: RecordingState;
  startedAt: string;
  updatedAt: string;
  pausedAt?: string | undefined;
  pauseReason?: 'manual' | 'recovered' | undefined;
  completedAt?: string | undefined;
  durationSeconds: number;
  distanceMeters: number;
  acceptedSamples: number;
  lastHeartbeatAt: string;
  remoteId?: string | undefined;
  syncError?: string | undefined;
}

export interface RecorderDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export const ACTIVITY_RECORDER_SCHEMA_VERSION = 7;
export const MAX_SAMPLE_ACCURACY_METERS = 50;
export const MAX_SEGMENT_SPEED_METERS_PER_SECOND = 25_000 / 3_600;
export const EXCLUDED_GAP_SECONDS = 60;

export const activityRecorderSchema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS recorded_activities (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('walk', 'run', 'hike')),
    state TEXT NOT NULL CHECK (state IN ('prepare', 'acquiring', 'active', 'paused', 'resumed', 'finishing', 'completed-local', 'queued', 'syncing', 'processed', 'failed', 'discarded')),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paused_at TEXT,
    pause_reason TEXT CHECK (pause_reason IN ('manual', 'recovered')),
    completed_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    distance_meters REAL NOT NULL DEFAULT 0,
    accepted_samples INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT NOT NULL,
    remote_id TEXT,
    sync_error TEXT
  );
  CREATE TABLE IF NOT EXISTS activity_location_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL REFERENCES recorded_activities(id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    altitude REAL,
    disposition TEXT NOT NULL DEFAULT 'usable' CHECK (disposition IN ('usable', 'weak-accuracy', 'gap-anchor', 'resume-anchor', 'impossible-segment')),
    segment_break INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS activity_samples_by_activity ON activity_location_samples(activity_id, recorded_at);
  CREATE UNIQUE INDEX IF NOT EXISTS unique_activity_sample ON activity_location_samples(activity_id, recorded_at, latitude, longitude);
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
  pauseReason: (row.pauseReason as 'manual' | 'recovered' | null) ?? undefined,
  completedAt: (row.completedAt as string | null) ?? undefined,
  durationSeconds: Number(row.durationSeconds),
  distanceMeters: Number(row.distanceMeters),
  acceptedSamples: Number(row.acceptedSamples),
  lastHeartbeatAt: row.lastHeartbeatAt as string,
  remoteId: (row.remoteId as string | null) ?? undefined,
  syncError: (row.syncError as string | null) ?? undefined
});

export const distanceBetween = (a: LocationSample, b: LocationSample): number => {
  const radius = 6_371_000;
  const radians = Math.PI / 180;
  const latDelta = (b.latitude - a.latitude) * radians;
  const lonDelta = (b.longitude - a.longitude) * radians;
  const x =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lonDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const elapsedSeconds = (earlier: string, later: string): number =>
  Math.max(0, (Date.parse(later) - Date.parse(earlier)) / 1000);

export const isUsableSample = (sample: LocationSample): boolean =>
  sample.accuracy !== null && sample.accuracy >= 0 && sample.accuracy <= MAX_SAMPLE_ACCURACY_METERS;

export const isWeakGpsSample = (sample: LocationSample): boolean => !isUsableSample(sample);

export const acceptedSegment = (
  previous: LocationSample | undefined,
  sample: LocationSample
): { distanceMeters: number; durationSeconds: number } => {
  if (!previous) return { distanceMeters: 0, durationSeconds: 0 };
  const elapsed = elapsedSeconds(previous.recordedAt, sample.recordedAt);
  const distance = distanceBetween(previous, sample);
  if (
    elapsed <= 0 ||
    elapsed > EXCLUDED_GAP_SECONDS ||
    distance / Math.max(elapsed, 1) > MAX_SEGMENT_SPEED_METERS_PER_SECOND
  )
    return { distanceMeters: 0, durationSeconds: 0 };
  return { distanceMeters: distance, durationSeconds: elapsed };
};

const canTransition = (from: RecordingState, to: RecordingState): boolean => {
  const transitions: Record<RecordingState, readonly RecordingState[]> = {
    prepare: ['acquiring', 'discarded'],
    acquiring: ['active', 'failed', 'discarded'],
    active: ['paused', 'finishing', 'failed'],
    paused: ['resumed', 'finishing', 'discarded'],
    resumed: ['active', 'paused', 'finishing', 'failed'],
    finishing: ['completed-local', 'failed'],
    'completed-local': ['queued', 'discarded'],
    queued: ['syncing', 'processed', 'discarded'],
    syncing: ['processed', 'queued', 'failed'],
    processed: [],
    failed: ['queued', 'processed', 'discarded'],
    discarded: []
  };
  return transitions[from].includes(to);
};

const sessionSelect = `SELECT id, account_id AS accountId, movement_type AS movementType, state, started_at AS startedAt, updated_at AS updatedAt,
  paused_at AS pausedAt, pause_reason AS pauseReason, completed_at AS completedAt, duration_seconds AS durationSeconds, distance_meters AS distanceMeters,
  accepted_samples AS acceptedSamples, last_heartbeat_at AS lastHeartbeatAt, remote_id AS remoteId, sync_error AS syncError FROM recorded_activities`;

const migrationChecksum = (
  rows: readonly Pick<ActivitySession, 'id' | 'remoteId' | 'updatedAt'>[]
): string => {
  let hash = 2_166_136_261;
  for (const character of rows
    .map((row) => `${row.id}:${row.remoteId ?? ''}:${row.updatedAt}`)
    .sort()
    .join('|'))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0).toString(16);
};

export const createActivityRecorder = (database: RecorderDatabase) => ({
  async initialize(): Promise<void> {
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const current = version?.user_version ?? 0;
    if (current > 0 && current < 5)
      await database.execAsync(
        'ALTER TABLE recorded_activities ADD COLUMN remote_id TEXT; ALTER TABLE recorded_activities ADD COLUMN sync_error TEXT;'
      );
    if (current > 0 && current < 7) {
      const sampleColumns = await database.getAllAsync<{ name: string }>(
        'PRAGMA table_info(activity_location_samples)'
      );
      const activityColumns = await database.getAllAsync<{ name: string }>(
        'PRAGMA table_info(recorded_activities)'
      );
      if (!sampleColumns.some((column) => column.name === 'disposition'))
        await database.execAsync(
          "ALTER TABLE activity_location_samples ADD COLUMN disposition TEXT NOT NULL DEFAULT 'usable';"
        );
      if (!sampleColumns.some((column) => column.name === 'segment_break'))
        await database.execAsync(
          'ALTER TABLE activity_location_samples ADD COLUMN segment_break INTEGER NOT NULL DEFAULT 0;'
        );
      if (!activityColumns.some((column) => column.name === 'pause_reason'))
        await database.execAsync(
          "ALTER TABLE recorded_activities ADD COLUMN pause_reason TEXT CHECK (pause_reason IN ('manual', 'recovered'));"
        );
    }
    await database.execAsync(activityRecorderSchema);
    // Preparation is now in-memory. Safely discard pre-route rows left by older builds so they
    // cannot become orphaned recovery/history entries; recording never reached route retention.
    await database.runAsync(
      "DELETE FROM recorded_activities WHERE state IN ('prepare', 'acquiring')"
    );
  },
  async discardLegacyPreparation(accountId: string): Promise<number> {
    const result = await database.runAsync(
      "DELETE FROM recorded_activities WHERE account_id = ? AND state IN ('prepare', 'acquiring')",
      accountId
    );
    return result.changes;
  },
  async create(
    session: Omit<ActivitySession, 'durationSeconds' | 'distanceMeters' | 'acceptedSamples'>
  ): Promise<void> {
    await database.runAsync(
      `INSERT INTO recorded_activities (id, account_id, movement_type, state, started_at, updated_at, paused_at, pause_reason, completed_at, duration_seconds, distance_meters, accepted_samples, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      session.id,
      session.accountId,
      session.movementType,
      session.state,
      session.startedAt,
      session.updatedAt,
      session.pausedAt ?? null,
      session.pauseReason ?? null,
      session.completedAt ?? null,
      session.lastHeartbeatAt
    );
  },
  async get(id: string, accountId: string): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `${sessionSelect} WHERE id = ? AND account_id = ?`,
      id,
      accountId
    );
    return row ? rowToSession(row) : undefined;
  },
  async recover(accountId: string): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `${sessionSelect} WHERE account_id = ? AND state IN ('active', 'paused', 'resumed', 'finishing') ORDER BY updated_at DESC LIMIT 1`,
      accountId
    );
    return row ? rowToSession(row) : undefined;
  },
  async recoverPaused(accountId: string, at: string): Promise<ActivitySession | undefined> {
    const recovered = await this.recover(accountId);
    if (!recovered) return undefined;
    if (recovered.state === 'active' || recovered.state === 'resumed')
      await this.transition(recovered.id, accountId, recovered.state, 'paused', at, 'recovered');
    return this.get(recovered.id, accountId);
  },
  async recoverAnyActive(): Promise<ActivitySession | undefined> {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `${sessionSelect} WHERE state IN ('active', 'resumed') ORDER BY updated_at DESC LIMIT 1`
    );
    return row ? rowToSession(row) : undefined;
  },
  async transition(
    id: string,
    accountId: string,
    from: RecordingState,
    to: RecordingState,
    at: string,
    pauseReason?: 'manual' | 'recovered'
  ): Promise<boolean> {
    if (!canTransition(from, to)) throw new Error(`Invalid recording transition: ${from} -> ${to}`);
    const result = await database.runAsync(
      `UPDATE recorded_activities SET state = ?, updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END, paused_at = CASE WHEN ? = 'paused' THEN ? ELSE paused_at END,
       pause_reason = CASE WHEN ? = 'paused' THEN ? WHEN ? = 'resumed' THEN NULL ELSE pause_reason END, completed_at = CASE WHEN ? = 'completed-local' THEN ? ELSE completed_at END WHERE id = ? AND account_id = ? AND state = ?`,
      to,
      at,
      at,
      to,
      at,
      to,
      pauseReason ?? 'manual',
      to,
      to,
      at,
      id,
      accountId,
      from
    );
    return result.changes === 1;
  },
  async heartbeat(id: string, accountId: string, at: string): Promise<void> {
    await database.runAsync(
      'UPDATE recorded_activities SET updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END, last_heartbeat_at = CASE WHEN last_heartbeat_at > ? THEN last_heartbeat_at ELSE ? END WHERE id = ? AND account_id = ?',
      at,
      at,
      at,
      at,
      id,
      accountId
    );
  },
  async appendSample(id: string, accountId: string, sample: LocationSample): Promise<boolean> {
    const session = await this.get(id, accountId);
    if (!session || !['active', 'resumed'].includes(session.state)) return false;
    const previousRow = await database.getFirstAsync<RecordedLocationSample>(
      'SELECT recorded_at AS recordedAt, latitude, longitude, accuracy, altitude, disposition, segment_break AS segmentBreak FROM activity_location_samples WHERE activity_id = ? ORDER BY recorded_at DESC LIMIT 1',
      id
    );
    const previous = previousRow && {
      ...previousRow,
      disposition: previousRow.disposition ?? 'usable',
      segmentBreak: Boolean(previousRow.segmentBreak)
    };
    if (
      previous &&
      previous.recordedAt === sample.recordedAt &&
      previous.latitude === sample.latitude &&
      previous.longitude === sample.longitude
    )
      return false;

    if (sample.accuracy === null || sample.accuracy < 0 || sample.accuracy > 100) return false;
    if (previous && Date.parse(sample.recordedAt) <= Date.parse(previous.recordedAt)) return false;
    const weak = sample.accuracy > MAX_SAMPLE_ACCURACY_METERS;
    const elapsed = previous ? elapsedSeconds(previous.recordedAt, sample.recordedAt) : 0;
    const previousCanConnect = previous?.disposition === 'usable';
    const segment =
      previousCanConnect && !weak
        ? acceptedSegment(previous, sample)
        : { distanceMeters: 0, durationSeconds: 0 };
    const impossible = Boolean(
      !weak &&
      previousCanConnect &&
      elapsed <= EXCLUDED_GAP_SECONDS &&
      segment.durationSeconds === 0
    );
    const gapAnchor = Boolean(
      !weak && previous && (elapsed > EXCLUDED_GAP_SECONDS || !previousCanConnect)
    );
    const resumeAnchor = Boolean(!weak && session.state === 'resumed');
    const disposition: SampleDisposition = weak
      ? 'weak-accuracy'
      : impossible
        ? 'impossible-segment'
        : resumeAnchor
          ? 'resume-anchor'
          : gapAnchor
            ? 'gap-anchor'
            : 'usable';
    const segmentBreak = disposition !== 'usable';
    const inserted = await database.runAsync(
      'INSERT OR IGNORE INTO activity_location_samples (activity_id, recorded_at, latitude, longitude, accuracy, altitude, disposition, segment_break) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      sample.recordedAt,
      sample.latitude,
      sample.longitude,
      sample.accuracy,
      sample.altitude,
      disposition,
      segmentBreak ? 1 : 0
    );
    if (inserted.changes !== 1) return false;
    const contributes = disposition === 'usable';
    await database.runAsync(
      "UPDATE recorded_activities SET state = CASE WHEN state = 'resumed' THEN 'active' ELSE state END, distance_meters = distance_meters + ?, duration_seconds = duration_seconds + ?, accepted_samples = accepted_samples + ?, updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END, last_heartbeat_at = CASE WHEN last_heartbeat_at > ? THEN last_heartbeat_at ELSE ? END WHERE id = ? AND account_id = ?",
      contributes ? segment.distanceMeters : 0,
      contributes ? segment.durationSeconds : 0,
      contributes ? 1 : 0,
      sample.recordedAt,
      sample.recordedAt,
      sample.recordedAt,
      sample.recordedAt,
      id,
      accountId
    );
    return true;
  },
  async liveSamples(id: string, accountId: string): Promise<RecordedLocationSample[]> {
    const session = await this.get(id, accountId);
    if (!session) return [];
    const rows = await database.getAllAsync<RecordedLocationSample>(
      'SELECT recorded_at AS recordedAt, latitude, longitude, accuracy, altitude, disposition, segment_break AS segmentBreak FROM activity_location_samples WHERE activity_id = ? ORDER BY recorded_at ASC',
      id
    );
    return rows.map((row) => ({ ...row, segmentBreak: Boolean(row.segmentBreak) }));
  },
  async samples(id: string, accountId: string): Promise<LocationSample[]> {
    const session = await this.get(id, accountId);
    if (!session) return [];
    return database.getAllAsync<LocationSample>(
      'SELECT recorded_at AS recordedAt, latitude, longitude, accuracy, altitude FROM activity_location_samples WHERE activity_id = ? ORDER BY recorded_at ASC',
      id
    );
  },
  async list(accountId: string): Promise<ActivitySession[]> {
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `${sessionSelect} WHERE account_id = ? AND state NOT IN ('prepare', 'acquiring', 'discarded') ORDER BY updated_at DESC`,
      accountId
    );
    return rows.map(rowToSession);
  },
  async rekeyLegacyScopes(accountId: string, legacyScopes: readonly string[]): Promise<number> {
    const scopes = [...new Set(legacyScopes.filter((scope) => scope !== accountId))];
    let moved = 0;
    for (const scope of scopes) {
      const sourceRows = await database.getAllAsync<Record<string, unknown>>(
        `${sessionSelect} WHERE account_id = ? ORDER BY id`,
        scope
      );
      if (!sourceRows.length) continue;
      const sourceChecksum = migrationChecksum(sourceRows.map(rowToSession));
      const result = await database.runAsync(
        'UPDATE recorded_activities SET account_id = ? WHERE account_id = ?',
        accountId,
        scope
      );
      const sourceRemaining = await database.getFirstAsync<{ count: number | string }>(
        'SELECT count(*) AS count FROM recorded_activities WHERE account_id = ?',
        scope
      );
      const destinationRows = await database.getAllAsync<Record<string, unknown>>(
        `${sessionSelect} WHERE account_id = ? ORDER BY id`,
        accountId
      );
      const destinationChecksum = migrationChecksum(
        destinationRows
          .map(rowToSession)
          .filter((row) => sourceRows.some((source) => source.id === row.id))
      );
      if (
        result.changes !== sourceRows.length ||
        Number(sourceRemaining?.count ?? 0) !== 0 ||
        destinationChecksum !== sourceChecksum
      )
        throw new Error(
          'Local activity account-scope migration count/checksum verification failed.'
        );
      moved += result.changes;
    }
    return moved;
  },
  async setRemote(id: string, accountId: string, remoteId: string): Promise<void> {
    await database.runAsync(
      'UPDATE recorded_activities SET remote_id = ?, sync_error = NULL WHERE id = ? AND account_id = ?',
      remoteId,
      id,
      accountId
    );
  },
  async markSyncFailure(id: string, accountId: string, at: string, message: string): Promise<void> {
    await database.runAsync(
      "UPDATE recorded_activities SET state = 'failed', updated_at = ?, sync_error = ? WHERE id = ? AND account_id = ?",
      at,
      message.slice(0, 160),
      id,
      accountId
    );
  },
  async remove(id: string, accountId: string): Promise<void> {
    await database.runAsync(
      'DELETE FROM recorded_activities WHERE id = ? AND account_id = ?',
      id,
      accountId
    );
  },
  async clearAccount(accountId: string): Promise<void> {
    await database.runAsync('DELETE FROM recorded_activities WHERE account_id = ?', accountId);
  }
});

export type ActivityRecorder = ReturnType<typeof createActivityRecorder>;
