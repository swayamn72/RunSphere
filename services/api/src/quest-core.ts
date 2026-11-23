import { withTransaction, type Database } from '@runsphere/db';
import { assessRunIntegrity, type ClaimPoint } from '@runsphere/domain';

/**
 * Quest lifecycle (M6.3, `docs/product.md` "Quest eligibility"): the server,
 * not the client, evaluates every checkpoint against the run's accepted trace.
 *
 * The rules, deterministic and stated here so they can be reviewed:
 *
 * - **Accepted trace:** the run's points with GPS accuracy of 50 m or better
 *   (the same bar `validateTrace` uses), recorded after the quest was accepted.
 *   A run that started before you accepted can't finish it.
 * - **Place and area checkpoints:** the trace passes within 30 m.
 * - **Route checkpoints:** the trace covers at least 80% of the path's length,
 *   within 30 m of it, so running past one end doesn't count as the corridor.
 * - **Time limit:** when staff set one (`quest_versions.time_limit_minutes`),
 *   every stop must be passed within that many minutes of the run's first
 *   point (`withinTimeLimit`). One run, one go: stops passed on separate runs
 *   never add up.
 * - Only derived runs that pass the integrity check, and only quests that are
 *   still published with no retired checkpoint (`published_quest_versions`).
 *
 * No XP is granted: there is no published rule for it, and ADR-0005 keeps
 * rewards to published rules. Completions are recorded with the run that
 * earned them, once per account and quest.
 */
export const QUEST_RULE = {
  maximumAccuracyMeters: 50,
  checkpointRadiusMeters: 30,
  routeCoverage: 0.8
} as const;

interface TracePoint extends ClaimPoint {
  readonly accuracyMeters?: number;
}

const tracePoints = (payload: unknown): TracePoint[] => {
  const chunk = payload as { points?: unknown };
  if (!Array.isArray(chunk.points)) return [];
  return chunk.points.flatMap((value) => {
    const raw = value as {
      latitude?: unknown;
      longitude?: unknown;
      recordedAt?: unknown;
      accuracyMeters?: unknown;
    };
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.recordedAt !== 'string'
    )
      return [];
    const at = new Date(raw.recordedAt);
    if (Number.isNaN(at.getTime())) return [];
    return [
      {
        latitude: raw.latitude,
        longitude: raw.longitude,
        at,
        ...(typeof raw.accuracyMeters === 'number' ? { accuracyMeters: raw.accuracyMeters } : {})
      }
    ];
  });
};

/** Accept a published quest; accepting again after abandoning reopens it. */
export const acceptQuest = async (
  database: Database,
  accountId: string,
  questId: string
): Promise<{ status: 'accepted' | 'completed'; acceptedAt: Date } | undefined> => {
  const published = await database.query(
    'SELECT 1 FROM published_quest_versions WHERE id::text = $1',
    [questId]
  );
  if (!published.rows[0]) return undefined;
  const accepted = await database.query<{ accepted_at: Date; completed: boolean }>(
    `INSERT INTO quest_acceptances (account_id, quest_version_id)
     VALUES ($1, $2::uuid)
     ON CONFLICT (account_id, quest_version_id)
       DO UPDATE SET abandoned_at = NULL,
         accepted_at = CASE WHEN quest_acceptances.abandoned_at IS NULL
           THEN quest_acceptances.accepted_at ELSE now() END
     RETURNING accepted_at,
       EXISTS (SELECT 1 FROM quest_completions completion
         WHERE completion.account_id = $1 AND completion.quest_version_id = $2::uuid) AS completed`,
    [accountId, questId]
  );
  const row = accepted.rows[0]!;
  return { status: row.completed ? 'completed' : 'accepted', acceptedAt: row.accepted_at };
};

/** Back out of a quest. Kept as abandoned, not deleted (`045`: it's a signal). */
export const abandonQuest = async (
  database: Database,
  accountId: string,
  questId: string
): Promise<boolean> => {
  const updated = await database.query(
    `UPDATE quest_acceptances SET abandoned_at = now()
     WHERE account_id = $1 AND quest_version_id::text = $2 AND abandoned_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM quest_completions completion
         WHERE completion.account_id = $1 AND completion.quest_version_id::text = $2)
     RETURNING id`,
    [accountId, questId]
  );
  return updated.rows.length > 0;
};

export interface MyQuest {
  questId: string;
  title: string;
  status: 'accepted' | 'completed';
  acceptedAt: string;
  completedAt?: string;
}

export const myQuests = async (database: Database, accountId: string): Promise<MyQuest[]> => {
  const rows = await database.query<{
    quest_id: string;
    title: string;
    accepted_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT acceptance.quest_version_id AS quest_id, quest.title, acceptance.accepted_at,
       completion.completed_at
     FROM quest_acceptances acceptance
     JOIN quest_versions quest ON quest.id = acceptance.quest_version_id
     LEFT JOIN quest_completions completion ON completion.account_id = acceptance.account_id
       AND completion.quest_version_id = acceptance.quest_version_id
     WHERE acceptance.account_id = $1
       AND (acceptance.abandoned_at IS NULL OR completion.id IS NOT NULL)
     ORDER BY coalesce(completion.completed_at, acceptance.accepted_at) DESC
     LIMIT 100`,
    [accountId]
  );
  return rows.rows.map((row) => ({
    questId: row.quest_id,
    title: row.title,
    status: row.completed_at ? 'completed' : 'accepted',
    acceptedAt: row.accepted_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {})
  }));
};

export const questsCompletedCount = async (
  database: Database,
  accountId: string
): Promise<number> =>
  Number(
    (
      await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM quest_completions WHERE account_id = $1',
        [accountId]
      )
    ).rows[0]?.count ?? 0
  );

/**
 * The part of a run that counts toward a quest with a time limit: the points
 * from the run's first point up to `limitMinutes` later. Every stop has to be
 * passed inside that window, so cutting the trace there is the whole rule. The
 * clock runs from the start of the run, pauses included, because the limit is
 * how long the runner has from setting off. No limit keeps every point.
 */
export const withinTimeLimit = <T extends { at: Date }>(
  points: readonly T[],
  limitMinutes: number | null
): T[] => {
  if (!limitMinutes || points.length === 0) return [...points];
  const deadline = points[0]!.at.getTime() + limitMinutes * 60_000;
  return points.filter((point) => point.at.getTime() <= deadline);
};

/**
 * The worker's hook after a run is derived: complete any open quest this run
 * satisfies. Returns the quest ids completed now. Idempotent: a retried event
 * finds them already completed and records nothing new.
 */
export const completeQuestsForActivity = async (
  database: Database,
  activityId: string
): Promise<string[]> => {
  const run = await database.query<{
    account_id: string;
    run_mode: string | null;
    quest_version_id: string | null;
  }>(
    `SELECT account_id, run_mode, quest_version_id FROM activity_submissions
     WHERE id = $1 AND status = 'derived' AND deleted_at IS NULL`,
    [activityId]
  );
  const accountId = run.rows[0]?.account_id;
  if (!accountId) return [];
  // Modes are independent (M9 9.4). A quest run counts only for the quest it
  // was started for; Free, Turf and Ghost Race runs complete nothing. A run
  // from before modes existed (no mode) is checked against every accepted
  // quest, as it always was.
  const mode = run.rows[0]!.run_mode;
  if (mode !== null && mode !== 'quest') return [];
  const onlyQuest = mode === 'quest' ? run.rows[0]!.quest_version_id : null;
  if (mode === 'quest' && !onlyQuest) return [];

  const open = await database.query<{
    quest_id: string;
    title: string;
    accepted_at: Date;
    time_limit_minutes: number | null;
  }>(
    `SELECT acceptance.quest_version_id AS quest_id, quest.title, acceptance.accepted_at,
       quest.time_limit_minutes
     FROM quest_acceptances acceptance
     JOIN published_quest_versions quest ON quest.id = acceptance.quest_version_id
     WHERE acceptance.account_id = $1 AND acceptance.abandoned_at IS NULL
       AND ($2::uuid IS NULL OR acceptance.quest_version_id = $2)
       AND NOT EXISTS (SELECT 1 FROM quest_completions completion
         WHERE completion.account_id = $1
           AND completion.quest_version_id = acceptance.quest_version_id)`,
    [accountId, onlyQuest]
  );
  if (open.rows.length === 0) return [];

  const chunks = await database.query<{ payload: unknown }>(
    'SELECT payload FROM activity_chunks WHERE activity_id = $1 ORDER BY sequence',
    [activityId]
  );
  const points = chunks.rows
    .flatMap((row) => tracePoints(row.payload))
    .filter((point) => (point.accuracyMeters ?? 0) <= QUEST_RULE.maximumAccuracyMeters);
  if (points.length < 2) return [];
  // A run the integrity check doesn't pass can't complete anything; it is
  // never punished for it, it simply doesn't count.
  if (assessRunIntegrity(points).verdict !== 'clean') return [];

  const completed: string[] = [];
  for (const quest of open.rows) {
    const after = withinTimeLimit(
      points.filter((point) => point.at >= quest.accepted_at),
      quest.time_limit_minutes
    );
    if (after.length < 2) continue;
    const trace = JSON.stringify({
      type: 'LineString',
      coordinates: after.map((point) => [point.longitude, point.latitude])
    });
    const check = await database.query<{ total: string; met: string }>(
      `WITH run AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS g)
       SELECT count(*)::text AS total,
         count(*) FILTER (WHERE CASE checkpoint.checkpoint_kind
           WHEN 'route' THEN
             ST_Length(ST_Intersection(checkpoint.geometry,
               ST_Buffer(run.g::geography, $3)::geometry)::geography)
               >= $4 * ST_Length(checkpoint.geometry::geography)
           ELSE ST_DWithin(run.g::geography, checkpoint.geometry::geography, $3)
         END)::text AS met
       FROM quest_version_checkpoints link
       JOIN curated_checkpoints checkpoint ON checkpoint.id = link.checkpoint_id
       CROSS JOIN run
       WHERE link.quest_version_id = $1`,
      [quest.quest_id, trace, QUEST_RULE.checkpointRadiusMeters, QUEST_RULE.routeCoverage]
    );
    const { total, met } = check.rows[0] ?? { total: '0', met: '0' };
    if (Number(total) === 0 || Number(met) < Number(total)) continue;

    const recorded = await withTransaction(database, async (client) => {
      const inserted = await client.query(
        `INSERT INTO quest_completions (account_id, quest_version_id, activity_submission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, quest_version_id) DO NOTHING
         RETURNING id`,
        [accountId, quest.quest_id, activityId]
      );
      if (!inserted.rows[0]) return false;
      await client.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, dedupe_key)
         VALUES ($1, 'quest', 'Quest complete', $2, $3)
         ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [accountId, `You finished ${quest.title}.`, `quest-complete:${quest.quest_id}`]
      );
      return true;
    });
    if (recorded) completed.push(quest.quest_id);
  }
  return completed;
};
