import { withTransaction, type Database } from '@runsphere/db';
import {
  seasonEnded,
  seasonMonthFor,
  seasonsDueForReset,
  type TurfStanding
} from '@runsphere/domain';
import { writeSeasonSnapshots } from './territory-claim-snapshots.js';

/**
 * The Turf monthly reset (pending-work 2.6).
 *
 * At 00:01 IST on the 1st every claim expires, the map clears, and everybody
 * starts the new month with nothing (`territory-guide.md`).
 *
 * **It is driven by state, not by a clock.** The job asks "is there an open
 * season that is not the current month" on every sweep. Nothing here reads a
 * cron expression or waits for a particular minute, and that is deliberate:
 *
 *   * It is idempotent, which the plan requires. Running twice in the same
 *     month finds nothing to do the second time.
 *   * It is self-healing. A worker that was down at 00:01 resets the moment it
 *     comes back, instead of the month silently never ending.
 *   * A deployment that was off for two months closes both, oldest first.
 *
 * The whole reset for one month is a single transaction. A half-reset season —
 * snapshots taken, claims still live, or claims archived with no snapshot — is
 * a month nobody can be told the truth about afterwards.
 *
 * **Nothing is deleted.** Claims are archived by being released; the rows, the
 * takeover ledger, and the snapshots all stay (`territory-guide.md`).
 */

export interface TerritorySeasonResetDeps {
  db: Database;
}

export interface SeasonResetOutcome {
  seasonMonth: string;
  claimsArchived: number;
  snapshotRowsWritten: number;
  notificationsQueued: number;
}

/** Seasons with claims that are still live but whose month has passed. */
const openSeasons = async (db: Database): Promise<string[]> => {
  const rows = await db.query<{ season_month: string }>(
    `SELECT season_month FROM territory_claim_seasons WHERE ended_at IS NULL ORDER BY season_month`
  );
  return rows.rows.map((row) => row.season_month);
};

/**
 * Make sure the month being played has a row.
 *
 * Called on every sweep rather than only after a reset, so a deployment that
 * has never reset anything still has a current season — and so the reset of
 * September does not depend on somebody having remembered to open October.
 */
export const openCurrentSeason = async (db: Database, now: Date): Promise<void> => {
  await db.query(
    `INSERT INTO territory_claim_seasons (season_month, started_at)
     VALUES ($1, $2) ON CONFLICT (season_month) DO NOTHING`,
    [seasonMonthFor(now), now]
  );
};

/**
 * Close one season: snapshot, archive, record, notify.
 *
 * The order matters and is the plan's: the final standing is taken **before**
 * anything is archived, because it is computed from live claims and there would
 * be none left afterwards.
 */
export const resetSeason = async (
  db: Database,
  seasonMonth: string,
  now: Date
): Promise<SeasonResetOutcome> =>
  withTransaction(db, async (client) => {
    // Claim the season inside the transaction. Two workers sweeping at once
    // must not both archive the same month, and the loser here simply finds
    // nothing open and moves on.
    const claimed = await client.query<{ season_month: string }>(
      `UPDATE territory_claim_seasons SET ended_at = $2
       WHERE season_month = $1 AND ended_at IS NULL
       RETURNING season_month`,
      [seasonMonth, now]
    );
    if (!claimed.rows[0]) {
      return {
        seasonMonth,
        claimsArchived: 0,
        snapshotRowsWritten: 0,
        notificationsQueued: 0
      };
    }

    // 1. The final standing, from claims that are still live.
    const snapshot = await writeSeasonSnapshots(client, {
      seasonMonth,
      kind: 'final',
      now
    });

    // 2. Archive. `season_expired` is recorded on the claim by releasing it
    // with no successor: nobody took this ground, the month ended under it.
    // `031` ties `released_at` and `released_to_claim_id` together, so the
    // constraint is relaxed for exactly this case rather than worked around by
    // inventing a claim to point at.
    const archived = await client.query<{ id: string }>(
      `UPDATE territory_claims
       SET released_at = $2, season_expired_at = $2
       WHERE season_month = $1 AND released_at IS NULL
       RETURNING id`,
      [seasonMonth, now]
    );

    await client.query(
      `UPDATE territory_claim_seasons SET reset_at = $2, claims_archived = $3
       WHERE season_month = $1`,
      [seasonMonth, now, archived.rows.length]
    );

    // 3. Tell everybody who held ground. Queued into the durable inbox, which
    // is the source of truth; push delivery reads from it later and applies
    // category preferences, quiet hours, and caps (ADR-0009).
    const notificationsQueued = await notifySeasonEnded(client, seasonMonth, snapshot);

    return {
      seasonMonth,
      claimsArchived: archived.rows.length,
      snapshotRowsWritten: snapshot.rowsWritten,
      notificationsQueued
    };
  });

/**
 * One inbox entry per runner who held ground, with their own final numbers.
 *
 * The rank quoted is their **city** rank where they have one, because a global
 * rank in the thousands is not a fact anybody can use. No coordinates, no route,
 * no comparison to a named rival — a city name and two numbers the boards
 * already publish (`screens.md` push catalogue).
 */
const notifySeasonEnded = async (
  client: Pick<Database, 'query'>,
  seasonMonth: string,
  snapshot: {
    globalStandings: TurfStanding[];
    placeByAccount: Map<string, { cityTag: string; rank: number; totalAreaSqm: number }>;
  }
): Promise<number> => {
  let queued = 0;
  for (const standing of snapshot.globalStandings) {
    const place = snapshot.placeByAccount.get(standing.accountId);
    // Peak rather than final: the month is remembered by the most somebody
    // held, not by whatever survived its last afternoon.
    const peak = await client.query<{ peak: string }>(
      `SELECT coalesce(max(peak_area_sqm), 0)::text AS peak
       FROM territory_claim_season_snapshots
       WHERE account_id = $1 AND season_month = $2`,
      [standing.accountId, seasonMonth]
    );
    const copy = seasonEnded({
      seasonMonth,
      rank: place?.rank ?? standing.rank,
      peakAreaSqm: Number(peak.rows[0]?.peak ?? standing.totalAreaSqm),
      ...(place ? { cityTag: place.cityTag } : {})
    });
    // One entry per account per season. Was a read-back of the deep link,
    // which two concurrent sweeps can both pass; `042` gives the inbox a
    // `dedupe_key` and a unique index, so the database decides instead.
    //
    // The key is not the deep link: `SEASON_ENDING_3D` points at the same
    // place, and the warning and the result are two different notices about
    // the same month.
    const written = await client.query<{ id: string }>(
      `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        standing.accountId,
        copy.kind,
        copy.title,
        copy.body,
        copy.deepLink,
        `season-ended:${seasonMonth}`
      ]
    );
    queued += written.rows.length;
  }
  return queued;
};

/**
 * One sweep of the season reset.
 *
 * Returns the number of claims archived, so the worker's maintenance total says
 * something when a month turns over and nothing on every other sweep.
 */
export const processTerritorySeasonReset = async (
  { db }: TerritorySeasonResetDeps,
  now: Date = new Date()
): Promise<{ seasonsReset: number; claimsArchived: number }> => {
  await openCurrentSeason(db, now);
  const due = seasonsDueForReset(await openSeasons(db), now);
  let claimsArchived = 0;
  let seasonsReset = 0;
  for (const seasonMonth of due) {
    const outcome = await resetSeason(db, seasonMonth, now);
    claimsArchived += outcome.claimsArchived;
    seasonsReset += 1;
  }
  return { seasonsReset, claimsArchived };
};
