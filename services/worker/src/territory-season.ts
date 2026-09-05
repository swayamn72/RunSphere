import type { Database } from '@runsphere/db';
import { withTransaction } from '@runsphere/db';
import {
  TERRITORY_CAPTURE_ENABLED,
  closedTerritoryWeeks,
  concentrationBreachRun,
  divisionConcentration,
  kolkataDate,
  seasonStandings,
  type WeeklyLadderRow
} from '@runsphere/domain';
import { snapshotTerritoryWeek, type TerritoryScoringDeps } from './territory-scoring.js';

/**
 * Season upkeep: finalizing closed weeks, recomputing the season ladder, and
 * the daily concentration observation (Phase 4, milestones 4.3, 4.4 and 4.6).
 *
 * **None of it runs.** `TERRITORY_CAPTURE_ENABLED` is false, so every entry
 * point below refuses before its first query, exactly as the scoring engine
 * does. These jobs are downstream of contributions that no deployment has ever
 * produced, and running them would only write rows describing an empty season.
 *
 * What separates this file from `territory-scoring.ts` is that nothing here
 * needs an H3 indexer or an eligibility dataset: a finalized week, a ladder,
 * and a concentration share are all arithmetic over rows that scoring already
 * wrote. The gate is the only thing standing in front of them.
 */

export type TerritorySeasonRefusal = 'capture_disabled' | 'no_live_season';

export interface TerritorySeasonOutcome {
  refusal?: TerritorySeasonRefusal;
  weeksFinalized: number;
  standingsWritten: number;
  divisionsChecked: number;
  /**
   * Divisions whose breach run reached the seven-day mark `product.md` acts on.
   * Reported so a sweep that finds one is visible in the logs rather than only
   * in a table somebody has to think to query.
   */
  awardsPausedDivisions: string[];
}

const idle = (refusal?: TerritorySeasonRefusal): TerritorySeasonOutcome => ({
  ...(refusal ? { refusal } : {}),
  weeksFinalized: 0,
  standingsWritten: 0,
  divisionsChecked: 0,
  awardsPausedDivisions: []
});

interface SeasonRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

/**
 * Snapshot every week of a season that has ended and has no snapshot yet.
 *
 * Weeks already finalized are skipped rather than recomputed: a second
 * automatic pass would write version N+1 of an unchanged week and make the
 * version history a record of how often the worker ran instead of a record of
 * corrections. Recomputation is a deliberate act, not a side effect of a sweep.
 */
export const finalizeDueTerritoryWeeks = async (
  deps: TerritoryScoringDeps,
  season: SeasonRow,
  now: Date
): Promise<number> => {
  if (!TERRITORY_CAPTURE_ENABLED) return 0;
  const finalized = await deps.db.query<{ week_starts_on: string }>(
    `SELECT week_starts_on::text AS week_starts_on FROM territory_week_state WHERE season_id = $1`,
    [season.id]
  );
  const already = new Set(finalized.rows.map((row) => row.week_starts_on));

  let count = 0;
  for (const week of closedTerritoryWeeks(season.starts_at, season.ends_at, now)) {
    if (already.has(week)) continue;
    const outcome = await snapshotTerritoryWeek(deps, season.id, week, now);
    // A refusal here is a reason to stop rather than to carry on to later
    // weeks: they share the same cause, and finalizing them out of order
    // would leave a gap that looks like a week nobody moved in.
    if (outcome.refusal) break;
    count += 1;
  }
  return count;
};

/**
 * Recompute the season ladder from each week's **current** snapshot version.
 *
 * This is a full recompute rather than an increment, and that is what makes a
 * rollback reach the ladder at all: repointing a week at an earlier version
 * changes what this sums on the next sweep, with no separate correction step to
 * forget.
 *
 * Participants who have withdrawn are removed rather than frozen in place. The
 * season is opt-in (ADR-0007), and leaving it should take somebody off the
 * ladder rather than leaving their name on a board they have quit.
 */
export const recomputeSeasonStandings = async (db: Database, seasonId: string): Promise<number> => {
  if (!TERRITORY_CAPTURE_ENABLED) return 0;
  const rows = await db.query<{
    account_id: string;
    division: string;
    week_starts_on: string | null;
    points: number | null;
  }>(
    `SELECT enrollment.account_id, enrollment.division,
       ladder.week_starts_on::text AS week_starts_on, ladder.points
     FROM territory_enrollments enrollment
     LEFT JOIN territory_week_state state ON state.season_id = enrollment.season_id
     LEFT JOIN territory_ladder_weeks ladder
       ON ladder.season_id = enrollment.season_id
       AND ladder.account_id = enrollment.account_id
       AND ladder.week_starts_on = state.week_starts_on
       AND ladder.version = state.current_version
     WHERE enrollment.season_id = $1 AND enrollment.withdrawn_at IS NULL`,
    [seasonId]
  );

  const divisions = new Map<string, string>();
  const ladder: WeeklyLadderRow[] = [];
  for (const row of rows.rows) {
    divisions.set(row.account_id, row.division);
    if (row.week_starts_on === null) continue;
    ladder.push({
      participantRef: row.account_id,
      weekStartsOn: row.week_starts_on,
      points: Number(row.points ?? 0)
    });
  }
  const standings = new Map(
    seasonStandings(ladder).map((standing) => [standing.participantRef, standing])
  );

  await withTransaction(db, async (client) => {
    // Anybody who has left the season leaves the ladder with it.
    await client.query(
      `DELETE FROM territory_season_standings standing
       WHERE standing.season_id = $1 AND NOT EXISTS (
         SELECT 1 FROM territory_enrollments enrollment
         WHERE enrollment.season_id = standing.season_id
           AND enrollment.account_id = standing.account_id
           AND enrollment.withdrawn_at IS NULL)`,
      [seasonId]
    );
    for (const [accountId, division] of divisions) {
      const standing = standings.get(accountId);
      await client.query(
        `INSERT INTO territory_season_standings (season_id, account_id, division, points,
           weeks_scored, computed_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (season_id, account_id) DO UPDATE SET division = EXCLUDED.division,
           points = EXCLUDED.points, weeks_scored = EXCLUDED.weeks_scored, computed_at = now()`,
        [seasonId, accountId, division, standing?.points ?? 0, standing?.weeksScored ?? 0]
      );
    }
  });
  return divisions.size;
};

/**
 * One day's concentration observation per division (`product.md`).
 *
 * Written every day whether or not it breaches, because the rule that matters
 * is seven **consecutive** breached days, and a run cannot be counted from
 * rows that only exist on bad days. The observation records shares, never the
 * per-participant points they were derived from: monitoring concentration does
 * not need to know who is at the top.
 *
 * Nothing here changes a standing. A sustained breach pauses awards analysis
 * and starts an investigation into cell scarcity and validation abuse — both of
 * which are things people do, not things a worker does.
 */
export const checkSeasonConcentration = async (
  db: Database,
  seasonId: string,
  observedOn: string
): Promise<{ divisionsChecked: number; awardsPausedDivisions: string[] }> => {
  if (!TERRITORY_CAPTURE_ENABLED) return { divisionsChecked: 0, awardsPausedDivisions: [] };
  const rows = await db.query<{ division: string; points: number }>(
    `SELECT division, points FROM territory_season_standings WHERE season_id = $1`,
    [seasonId]
  );
  const byDivision = new Map<string, number[]>();
  for (const row of rows.rows) {
    const points = byDivision.get(row.division) ?? [];
    points.push(Number(row.points));
    byDivision.set(row.division, points);
  }

  const awardsPausedDivisions: string[] = [];
  for (const [division, points] of byDivision) {
    const concentration = divisionConcentration(points);
    const previous = await db.query<{ breach_run_days: number }>(
      `SELECT breach_run_days FROM territory_concentration_checks
       WHERE season_id = $1 AND division = $2 AND observed_on = $3::date - 1`,
      [seasonId, division, observedOn]
    );
    const runDays = concentrationBreachRun(
      Number(previous.rows[0]?.breach_run_days ?? 0),
      concentration.breached
    );
    await db.query(
      `INSERT INTO territory_concentration_checks (season_id, division, observed_on, participants,
         top_decile_share, top_participant_share, applicable, breached, breach_run_days)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (season_id, division, observed_on)
       DO UPDATE SET participants = EXCLUDED.participants,
         top_decile_share = EXCLUDED.top_decile_share,
         top_participant_share = EXCLUDED.top_participant_share,
         applicable = EXCLUDED.applicable, breached = EXCLUDED.breached,
         breach_run_days = EXCLUDED.breach_run_days`,
      [
        seasonId,
        division,
        observedOn,
        concentration.participants,
        concentration.topDecileShare.toFixed(5),
        concentration.topParticipantShare.toFixed(5),
        concentration.applicable,
        concentration.breached,
        runDays
      ]
    );
    if (concentration.breached && runDays >= 7) awardsPausedDivisions.push(division);
  }
  return { divisionsChecked: byDivision.size, awardsPausedDivisions };
};

/**
 * The season sweep the worker calls each pass.
 *
 * Order matters and is the same order the facts depend on each other in:
 * finalize the weeks that have ended, recompute the ladder from what those
 * weeks now say, then observe concentration on a ladder that is already
 * current. Observing first would report yesterday's shares as today's.
 */
export const processTerritorySeasons = async (
  deps: TerritoryScoringDeps,
  now: Date = new Date()
): Promise<TerritorySeasonOutcome> => {
  if (!TERRITORY_CAPTURE_ENABLED) return idle('capture_disabled');

  const live = await deps.db.query<SeasonRow>(
    `SELECT id, starts_at, ends_at FROM territory_seasons WHERE status = 'live' LIMIT 1`
  );
  const season = live.rows[0];
  if (!season) return idle('no_live_season');

  const weeksFinalized = await finalizeDueTerritoryWeeks(deps, season, now);
  const standingsWritten = await recomputeSeasonStandings(deps.db, season.id);
  const concentration = await checkSeasonConcentration(deps.db, season.id, kolkataDate(now));
  return {
    weeksFinalized,
    standingsWritten,
    divisionsChecked: concentration.divisionsChecked,
    awardsPausedDivisions: concentration.awardsPausedDivisions
  };
};
