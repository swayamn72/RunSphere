import { withTransaction, type Database } from '@runsphere/db';
import { rankWeekStart, seasonMonthFor, weeklyRank } from '@runsphere/domain';
import { writeSeasonSnapshots } from './territory-claim-snapshots.js';

/**
 * The Turf weekly rank snapshot (pending-work 2.7).
 *
 * Every Monday 00:01 IST, a rank and an area for each runner, frozen. Two
 * things need it:
 *
 *   * The app's **This Week** board, which has to be a rank that stopped
 *     moving. A live board recomputed on every read is *this moment*, not this
 *     week, and a runner refreshing it twice sees two different positions.
 *   * The season's **peak**, which is the figure a month is remembered by.
 *     Without weekly marks a peak can only equal the final total, and a runner
 *     who held 90,000 m² in week two and lost most of it on the 30th would be
 *     remembered by the wrong number.
 *
 * Like the reset, it is driven by state and not by a clock: it asks whether
 * this Kolkata week already has a snapshot, so a worker that was down on Monday
 * takes it on Tuesday and a sweep that runs every five seconds does nothing
 * 99.99% of the time.
 *
 * The week is the Monday-based Asia/Kolkata week every other period in this
 * product uses (ADR-0006), so a Turf week and a challenge week are the same
 * seven days.
 */

export interface TerritoryRankDeps {
  db: Database;
}

export interface WeeklyRankOutcome {
  seasonMonth: string;
  weekStart: string;
  rowsWritten: number;
  notificationsQueued: number;
}

/**
 * Whether anybody holds ground in this season at all.
 *
 * One indexed existence check, so an idle week costs no transaction. It matters
 * because the sweep runs every five seconds and a week has 120,960 of them.
 */
const anyGroundHeld = async (db: Database, seasonMonth: string): Promise<boolean> => {
  const held = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM territory_claims
     WHERE released_at IS NULL AND season_month = $1 LIMIT 1`,
    [seasonMonth]
  );
  return Boolean(held.rows[0]);
};

/** Whether this Kolkata week has already been recorded for this season. */
const alreadyTaken = async (
  db: Database,
  seasonMonth: string,
  weekStart: string
): Promise<boolean> => {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM territory_claim_season_snapshots
     WHERE season_month = $1 AND kind = 'weekly' AND week_start = $2::date
     LIMIT 1`,
    [seasonMonth, weekStart]
  );
  return Boolean(existing.rows[0]);
};

/**
 * Take one week's ranks.
 *
 * In a transaction because a partially-written week is a board that ranks some
 * people and not others, and the upsert would then never repair it: the "has
 * this week been taken" check would find the rows that did land and conclude
 * the job was done.
 */
export const takeWeeklyRanks = async (db: Database, now: Date): Promise<WeeklyRankOutcome> => {
  const seasonMonth = seasonMonthFor(now);
  const weekStart = rankWeekStart(now);
  return withTransaction(db, async (client) => {
    const snapshot = await writeSeasonSnapshots(client, {
      seasonMonth,
      kind: 'weekly',
      weekStart,
      now
    });

    let notificationsQueued = 0;
    for (const standing of snapshot.globalStandings) {
      const place = snapshot.placeByAccount.get(standing.accountId);
      const copy = weeklyRank({
        weekStart,
        rank: place?.rank ?? standing.rank,
        totalAreaSqm: standing.totalAreaSqm,
        ...(place ? { cityTag: place.cityTag } : {})
      });
      // One entry per account per week. Was a read-back of the deep link,
      // which is a race between two sweeps five seconds apart; `042` gives the
      // inbox a `dedupe_key` and a unique index, so the database decides.
      await client.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [
          standing.accountId,
          copy.kind,
          copy.title,
          copy.body,
          copy.deepLink,
          `weekly-rank:${weekStart}`
        ]
      );
      notificationsQueued += 1;
    }

    return { seasonMonth, weekStart, rowsWritten: snapshot.rowsWritten, notificationsQueued };
  });
};

/**
 * One sweep of the weekly rank job.
 *
 * Returns rows written, which is zero on all but one sweep a week — the check
 * that makes that cheap is a single indexed read.
 */
export const processTerritoryRanks = async (
  { db }: TerritoryRankDeps,
  now: Date = new Date()
): Promise<{ weeksRecorded: number; rowsWritten: number }> => {
  const seasonMonth = seasonMonthFor(now);
  const weekStart = rankWeekStart(now);
  if (await alreadyTaken(db, seasonMonth, weekStart)) return { weeksRecorded: 0, rowsWritten: 0 };
  // A week in which nobody holds ground has no ranks to record, and no marker
  // row says so — so without this check the job would open a transaction, read
  // three tables, write nothing and commit, on every sweep until next Monday.
  if (!(await anyGroundHeld(db, seasonMonth))) return { weeksRecorded: 0, rowsWritten: 0 };

  const outcome = await takeWeeklyRanks(db, now);
  return { weeksRecorded: outcome.rowsWritten > 0 ? 1 : 0, rowsWritten: outcome.rowsWritten };
};
