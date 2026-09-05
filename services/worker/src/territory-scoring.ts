import { withTransaction, type Database } from '@runsphere/db';
import {
  TERRITORY_CAPTURE_ENABLED,
  dailyContribution,
  kolkataDate,
  parseTerritoryScoringRule,
  resolveCellControl,
  territoryWeekClosed,
  weeklyLadderPoints,
  weeklyPeriodStart,
  type AcceptedContribution,
  type CellIndexer,
  type EligibilitySource,
  type TerritoryScoringRule,
  type TracePoint
} from '@runsphere/domain';

/**
 * Territory scoring (Phase 4, milestone 4.2; ADR-0001, ADR-0008).
 *
 * **This does not run.** Three things must be true before it scores anything,
 * and none of them is true today:
 *
 *   1. The Territory gate in the release plan has passed. Until then
 *      `TERRITORY_CAPTURE_ENABLED` is false and every entry point returns
 *      immediately.
 *   2. An H3 indexer is supplied. No H3 library is a dependency of this
 *      workspace; ADR-0001 requires its version pinned per contribution, so it
 *      is injected rather than imported.
 *   3. A public-space eligibility source is supplied. **No such dataset
 *      exists.** Scoring every traversed cell instead would record where people
 *      live and work, which is what public-space eligibility exists to
 *      prevent — so its absence stops the job rather than widening it.
 *
 * Each of those is a refusal with a reason, not a silent no-op, because a
 * scoring job that quietly does nothing is indistinguishable from one that is
 * broken.
 */

export type TerritoryScoringRefusal =
  | 'capture_disabled'
  | 'no_indexer'
  | 'no_eligibility_source'
  | 'no_published_rule'
  | 'week_not_closed';

export interface TerritoryScoringDeps {
  db: Database;
  /** Absent until an H3 library is a dependency and its version is pinned. */
  indexer?: CellIndexer | undefined;
  /** Absent until a public-space dataset exists. */
  eligibility?: EligibilitySource | undefined;
}

export interface TerritoryScoringOutcome {
  refusal?: TerritoryScoringRefusal;
  contributionsWritten: number;
}

interface ActivityPointRow {
  account_id: string;
  payload: unknown;
}

/**
 * Timestamped points come from `activity_chunks`, not from the derived route:
 * `activity_derivations.shareable_route` is a geometry with no time dimension,
 * and the best-contiguous-window rule needs times.
 *
 * That has a consequence worth stating: scoring must happen while the raw trace
 * is still inside its retention window. Afterwards the points are gone and only
 * the cells they produced remain, which is the outcome the privacy design
 * wants — but it means a late season cannot be scored retroactively.
 */
const pointsFrom = (payload: unknown): TracePoint[] => {
  const chunk = payload as { points?: unknown };
  if (!Array.isArray(chunk.points)) return [];
  return chunk.points.flatMap((value) => {
    const raw = value as { latitude?: unknown; longitude?: unknown; recordedAt?: unknown };
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.recordedAt !== 'string'
    )
      return [];
    const at = new Date(raw.recordedAt);
    return Number.isNaN(at.getTime())
      ? []
      : [{ latitude: raw.latitude, longitude: raw.longitude, at }];
  });
};

const loadRule = async (
  db: Database,
  version: number
): Promise<TerritoryScoringRule | undefined> => {
  const result = await db.query<{ definition: unknown }>(
    `SELECT definition FROM rule_versions WHERE kind = 'territory' AND version = $1`,
    [version]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  try {
    return parseTerritoryScoringRule(row.definition);
  } catch {
    // A rule version that predates the scoring parameters — `028` published
    // bands only — is not a rule this engine can score under.
    return undefined;
  }
};

/**
 * Derive one day's contributions for every enrolled participant of a live
 * season, and store them.
 *
 * A contribution is written once per participant per cell per local day; the
 * unique index is the guarantee, and the insert is idempotent so re-running a
 * day cannot inflate anybody's presence.
 */
export const scoreTerritoryDay = async (
  deps: TerritoryScoringDeps,
  seasonId: string,
  localDate: string
): Promise<TerritoryScoringOutcome> => {
  if (!TERRITORY_CAPTURE_ENABLED) return { refusal: 'capture_disabled', contributionsWritten: 0 };
  if (!deps.indexer) return { refusal: 'no_indexer', contributionsWritten: 0 };
  if (!deps.eligibility) return { refusal: 'no_eligibility_source', contributionsWritten: 0 };
  const { db, indexer, eligibility } = deps;

  const season = await db.query<{ scoring_rule_version: number }>(
    `SELECT scoring_rule_version FROM territory_seasons WHERE id = $1 AND status = 'live'`,
    [seasonId]
  );
  const version = season.rows[0]?.scoring_rule_version;
  if (!version) return { refusal: 'no_published_rule', contributionsWritten: 0 };
  const rule = await loadRule(db, version);
  if (!rule) return { refusal: 'no_published_rule', contributionsWritten: 0 };

  // Only enrolled, still-enrolled participants, and only their own validated
  // activity: a season reads nothing about anybody who did not opt in.
  const chunks = await db.query<ActivityPointRow>(
    `SELECT submission.account_id, chunk.payload
     FROM territory_enrollments enrollment
     JOIN activity_submissions submission ON submission.account_id = enrollment.account_id
       AND submission.status = 'derived' AND submission.deleted_at IS NULL
       AND submission.raw_trace_purged_at IS NULL
       AND (submission.processed_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
     JOIN activity_chunks chunk ON chunk.activity_id = submission.id
     WHERE enrollment.season_id = $1 AND enrollment.withdrawn_at IS NULL
     ORDER BY submission.account_id, chunk.sequence`,
    [seasonId, localDate]
  );

  const byAccount = new Map<string, TracePoint[]>();
  for (const row of chunks.rows) {
    const points = byAccount.get(row.account_id) ?? [];
    points.push(...pointsFrom(row.payload));
    byAccount.set(row.account_id, points);
  }

  let written = 0;
  for (const [accountId, points] of byAccount) {
    const contribution = dailyContribution(points, rule, indexer, eligibility);
    if (!contribution) continue;
    for (const cell of contribution.cells) {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO territory_cell_contributions (season_id, account_id, cell_index, h3_version,
           h3_resolution, algorithm_version, eligibility_version, local_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
         ON CONFLICT (season_id, account_id, cell_index, local_date) DO NOTHING
         RETURNING id`,
        [
          seasonId,
          accountId,
          cell,
          indexer.h3Version,
          indexer.resolution,
          indexer.algorithmVersion,
          eligibility.version,
          contribution.localDate
        ]
      );
      if (inserted.rows[0]) written += 1;
    }
  }
  return { contributionsWritten: written };
};

/**
 * Recompute one week's cell control and ladder points as a new immutable
 * snapshot version (ADR-0008).
 *
 * Nothing is updated: a recomputation writes version N+1 and leaves N in place,
 * so a correction is auditable and reversible, and a participant can be shown
 * what changed rather than discovering their week silently rewritten.
 *
 * A week is snapshotted only once it has completely ended (milestone 4.3).
 * Snapshotting a week still running would publish a standing that is about to
 * change, and ADR-0006 makes a weekly period immutable once written — so the
 * first version of every week would be wrong by construction.
 */
export const snapshotTerritoryWeek = async (
  deps: TerritoryScoringDeps,
  seasonId: string,
  weekStartsOn: string,
  now: Date = new Date()
): Promise<TerritoryScoringOutcome> => {
  if (!TERRITORY_CAPTURE_ENABLED) return { refusal: 'capture_disabled', contributionsWritten: 0 };
  if (!territoryWeekClosed(weekStartsOn, now))
    return { refusal: 'week_not_closed', contributionsWritten: 0 };
  const { db } = deps;

  const season = await db.query<{ scoring_rule_version: number }>(
    'SELECT scoring_rule_version FROM territory_seasons WHERE id = $1',
    [seasonId]
  );
  const version = season.rows[0]?.scoring_rule_version;
  if (!version) return { refusal: 'no_published_rule', contributionsWritten: 0 };
  const rule = await loadRule(db, version);
  if (!rule) return { refusal: 'no_published_rule', contributionsWritten: 0 };

  const rows = await db.query<{
    cell_index: string;
    account_id: string;
    local_date: string;
    accepted_at: Date;
  }>(
    `SELECT cell_index, account_id, local_date::text AS local_date, accepted_at
     FROM territory_cell_contributions
     WHERE season_id = $1 AND local_date >= $2::date AND local_date < $2::date + 7`,
    [seasonId, weekStartsOn]
  );

  // The opaque reference is the account id inside the worker and never leaves
  // it: the snapshot stores it, and no route returns it (`safety-and-privacy`).
  const contributions: AcceptedContribution[] = rows.rows.map((row) => ({
    cellIndex: row.cell_index,
    participantRef: row.account_id,
    localDate: row.local_date,
    acceptedAt: row.accepted_at
  }));
  const controls = resolveCellControl(contributions);
  const participants = [...new Set(contributions.map((row) => row.participantRef))];

  await withTransaction(db, async (client) => {
    const previous = await client.query<{ version: number }>(
      `SELECT coalesce(max(version), 0) AS version FROM territory_cell_control
       WHERE season_id = $1 AND week_starts_on = $2::date`,
      [seasonId, weekStartsOn]
    );
    const next = (previous.rows[0]?.version ?? 0) + 1;
    for (const control of controls) {
      await client.query(
        `INSERT INTO territory_cell_control (season_id, week_starts_on, version, cell_index,
           controlling_participant_ref, control_days)
         VALUES ($1, $2::date, $3, $4, $5, $6)`,
        [seasonId, weekStartsOn, next, control.cellIndex, control.participantRef, control.days]
      );
    }
    for (const participantRef of participants) {
      await client.query(
        `INSERT INTO territory_ladder_weeks (season_id, account_id, week_starts_on, version, points)
         VALUES ($1, $2, $3::date, $4, $5)`,
        [
          seasonId,
          participantRef,
          weekStartsOn,
          next,
          weeklyLadderPoints(controls, participantRef, rule)
        ]
      );
    }
    // The pointer at the version this week now shows. Only this moves — the
    // snapshot rows above are never edited — so a rollback is a change of
    // which existing version is read (milestone 4.6).
    await client.query(
      `INSERT INTO territory_week_state (season_id, week_starts_on, current_version)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (season_id, week_starts_on)
       DO UPDATE SET current_version = EXCLUDED.current_version, updated_at = now()`,
      [seasonId, weekStartsOn, next]
    );
  });
  return { contributionsWritten: controls.length };
};

/**
 * The sweep the worker would call.
 *
 * It refuses before touching the database at all, so a deployment without the
 * gate, an indexer, or an eligibility dataset does no territory work and says
 * why — rather than running a query that finds nothing and looking healthy.
 */
export const processTerritory = async (
  deps: TerritoryScoringDeps,
  now: Date = new Date()
): Promise<TerritoryScoringOutcome> => {
  if (!TERRITORY_CAPTURE_ENABLED) return { refusal: 'capture_disabled', contributionsWritten: 0 };
  if (!deps.indexer) return { refusal: 'no_indexer', contributionsWritten: 0 };
  if (!deps.eligibility) return { refusal: 'no_eligibility_source', contributionsWritten: 0 };

  const live = await deps.db.query<{ id: string }>(
    `SELECT id FROM territory_seasons WHERE status = 'live' LIMIT 1`
  );
  const seasonId = live.rows[0]?.id;
  if (!seasonId) return { contributionsWritten: 0 };

  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = await scoreTerritoryDay(deps, seasonId, kolkataDate(yesterday));
  const week = await snapshotTerritoryWeek(
    deps,
    seasonId,
    kolkataDate(weeklyPeriodStart(yesterday)),
    now
  );
  return {
    ...(day.refusal ? { refusal: day.refusal } : {}),
    contributionsWritten: day.contributionsWritten + week.contributionsWritten
  };
};
