import type { Database } from '@runsphere/db';
import {
  daysUntilSeasonEnd,
  isSeasonEndingSoon,
  seasonEnding,
  seasonMonthFor
} from '@runsphere/domain';
import { liveStandings } from './territory-claim-snapshots.js';

/**
 * `SEASON_ENDING_3D`: the three-day warning before the monthly Turf reset
 * (`screens.md` push catalogue).
 *
 * **State-driven, like the reset itself.** The job asks "is the current season
 * within three days of closing" on every sweep rather than waiting for a
 * particular minute, for the reasons `territory-season-reset-job.ts` sets out:
 * it is idempotent, and a worker that was down at the boundary still sends the
 * warning when it comes back rather than skipping the month.
 *
 * The consequence is that the notice can go out with fewer than three days
 * left, so it reports the days it actually has (`seasonEnding`) instead of the
 * literal "3 days" the copy specifies. A notice that is wrong about the
 * deadline is worse than one whose wording varies.
 *
 * **Only people holding ground are told.** The copy is "You hold rank #[N]
 * with [Xm²]", which is not a sentence you can write for somebody holding
 * nothing, and "the season you did not play in is ending" is not news.
 */

export interface TerritorySeasonEndingDeps {
  db: Database;
}

export interface SeasonEndingOutcome {
  seasonMonth: string;
  daysRemaining: number;
  notificationsQueued: number;
}

/**
 * One notice per account per season, enforced by the unique index on
 * `(account_id, dedupe_key)` from `042` rather than by a read-back.
 *
 * The read-back pattern the other two territory jobs use is a race: two
 * sweeps, five seconds apart, can both find nothing and both insert. That has
 * been survivable there because both run rarely; this one runs on every sweep
 * for three days, so it needed the index.
 */
const dedupeKeyFor = (seasonMonth: string): string => `season-ending:${seasonMonth}`;

/**
 * One sweep. Returns `undefined` outside the three-day window, which is most
 * of the month and costs nothing: `isSeasonEndingSoon` is arithmetic.
 */
export const processTerritorySeasonEnding = async (
  { db }: TerritorySeasonEndingDeps,
  now: Date = new Date()
): Promise<SeasonEndingOutcome | undefined> => {
  if (!isSeasonEndingSoon(now)) return undefined;

  const seasonMonth = seasonMonthFor(now);
  const daysRemaining = daysUntilSeasonEnd(now);

  // Cheap guard before the standings read, which is the expensive part. Once
  // everybody who holds ground has been told, the remaining three days of
  // sweeps cost one indexed count each.
  const alreadyTold = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM notification_inbox WHERE dedupe_key = $1',
    [dedupeKeyFor(seasonMonth)]
  );

  const { globalStandings, placeByAccount } = await liveStandings(db, seasonMonth, now);
  if (globalStandings.length === 0) return { seasonMonth, daysRemaining, notificationsQueued: 0 };
  if (Number(alreadyTold.rows[0]?.count ?? 0) >= globalStandings.length)
    return { seasonMonth, daysRemaining, notificationsQueued: 0 };

  let notificationsQueued = 0;
  for (const standing of globalStandings) {
    const place = placeByAccount.get(standing.accountId);
    const copy = seasonEnding({
      seasonMonth,
      // The city rank where there is one: a global rank in the thousands is not
      // something anybody can act on in three days.
      rank: place?.rank ?? standing.rank,
      totalAreaSqm: place?.totalAreaSqm ?? standing.totalAreaSqm,
      daysRemaining
    });
    // `DO NOTHING` returns no row when the notice was already sent, which is
    // how the count stays honest across the three days of sweeps.
    const written = await db.query<{ id: string }>(
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
        dedupeKeyFor(seasonMonth)
      ]
    );
    notificationsQueued += written.rows.length;
  }

  return { seasonMonth, daysRemaining, notificationsQueued };
};
