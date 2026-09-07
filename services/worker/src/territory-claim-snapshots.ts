import type { Database } from '@runsphere/db';
import {
  SHARING_SUSPENDED_KINDS,
  beatsRecord,
  hallOfFameCandidates,
  peakAreaSqm,
  turfStandings,
  type TurfHolding,
  type TurfStanding
} from '@runsphere/domain';

/**
 * Turf season standings, frozen (pending-work 2.5-2.7).
 *
 * Shared by the weekly rank job and the monthly reset, because both do the same
 * thing at different moments: read who holds what, rank it per place, and write
 * it down. One implementation means a Monday rank and a final rank can never be
 * computed two different ways — which would show somebody finishing the month
 * behind where they stood on the last Monday without having lost anything.
 *
 * **Ranks are per place scope.** The same runner has a city rank, a country
 * rank, and a global rank, and the app shows all three. A row is written for
 * each, so a historical board is one indexed read rather than a recompute over
 * archived claims whose ground now belongs to somebody else.
 *
 * Untagged claims count on the global board and on no place board. That is the
 * honest treatment: the ground is held, and nobody knows where.
 */

/** Either a pool or a transaction client — both only need to run queries. */
type Queryable = Pick<Database, 'query'>;

/** A place a board is drawn for. */
export interface BoardScope {
  scope: 'city' | 'country' | 'global';
  /** City name, ISO country code, or the literal `GLOBAL`. */
  scopeKey: string;
}

export const GLOBAL_SCOPE: BoardScope = { scope: 'global', scopeKey: 'GLOBAL' };

interface HoldingRow {
  account_id: string;
  total_area: string;
  claim_count: string;
  largest_claim: string;
  longest_held_days: string;
}

/**
 * Ground currently held in one season, by account, for one place.
 *
 * Excludes suspended accounts and ground a human confirmed was being traded —
 * the same two exclusions the live board applies. Written out again here rather
 * than shared with the API, because a snapshot has to record what the board
 * showed and not what the table happened to hold.
 */
const holdingsFor = async (
  db: Queryable,
  seasonMonth: string,
  place: BoardScope,
  now: Date
): Promise<TurfHolding[]> => {
  const values: unknown[] = [seasonMonth, [...SHARING_SUSPENDED_KINDS], now];
  // The place filter is appended as $4 when there is one, so the three fixed
  // parameters keep their numbers on every branch.
  let placeFilter = '';
  if (place.scope === 'city') {
    values.push(place.scopeKey);
    placeFilter = 'AND claim.city_tag = $4';
  } else if (place.scope === 'country') {
    values.push(place.scopeKey);
    placeFilter = 'AND claim.country_tag = $4';
  }

  const rows = await db.query<HoldingRow>(
    `SELECT claim.account_id,
       coalesce(sum(claim.area_sqm), 0)::text AS total_area,
       count(*)::text AS claim_count,
       coalesce(max(claim.area_sqm), 0)::text AS largest_claim,
       -- The greatest(0, ...) is not defensive noise. floor() of a small
       -- negative is -1, and this difference IS negative whenever a claim was
       -- made in the same second as the snapshot, or the application clock sits
       -- a moment behind the database one. That wrote -1 into a column
       -- constrained non-negative and failed the whole pass.
       coalesce(max(greatest(0, floor(
         extract(epoch FROM ($3::timestamptz - claim.claimed_at)) / 86400))), 0)::text
         AS longest_held_days
     FROM territory_claims claim
     JOIN accounts account ON account.id = claim.account_id AND account.deleted_at IS NULL
     WHERE claim.released_at IS NULL
       AND claim.season_month = $1
       ${placeFilter}
       AND NOT EXISTS (SELECT 1 FROM sanctions suspension
         WHERE suspension.account_id = claim.account_id
           AND suspension.kind = ANY($2::text[])
           AND suspension.revoked_at IS NULL
           AND (suspension.expires_at IS NULL OR suspension.expires_at > now()))
       AND NOT EXISTS (SELECT 1 FROM territory_trade_flags flag
         WHERE flag.lineage_id = claim.lineage_id AND flag.review_outcome = 'upheld')
     GROUP BY claim.account_id`,
    values
  );

  return rows.rows.map((row) => ({
    accountId: row.account_id,
    totalAreaSqm: Number(row.total_area),
    claimCount: Number(row.claim_count),
    largestClaimSqm: Number(row.largest_claim),
    longestHeldDays: Number(row.longest_held_days)
  }));
};

/**
 * Every place with ground held in a season, plus the global board.
 *
 * Derived from the claims rather than from a list of cities, so a runner in a
 * city nobody has claimed in before gets a board the first time they claim, and
 * a city everybody left stops having one.
 */
export const boardScopesFor = async (db: Queryable, seasonMonth: string): Promise<BoardScope[]> => {
  const places = await db.query<{ scope: string; scope_key: string }>(
    `SELECT 'city' AS scope, city_tag AS scope_key
       FROM territory_claims
       WHERE released_at IS NULL AND season_month = $1 AND city_tag IS NOT NULL
       GROUP BY city_tag
     UNION ALL
     SELECT 'country' AS scope, country_tag AS scope_key
       FROM territory_claims
       WHERE released_at IS NULL AND season_month = $1 AND country_tag IS NOT NULL
       GROUP BY country_tag
     ORDER BY scope, scope_key`,
    [seasonMonth]
  );
  return [
    GLOBAL_SCOPE,
    ...places.rows.map((row) => ({
      scope: row.scope as 'city' | 'country',
      scopeKey: row.scope_key
    }))
  ];
};

/** The peak each account has already recorded in this season, for this place. */
const peaksFor = async (
  db: Queryable,
  seasonMonth: string,
  place: BoardScope
): Promise<Map<string, number>> => {
  const rows = await db.query<{ account_id: string; peak: string }>(
    `SELECT account_id, coalesce(max(peak_area_sqm), 0)::text AS peak
     FROM territory_claim_season_snapshots
     WHERE season_month = $1 AND scope = $2 AND scope_key = $3
     GROUP BY account_id`,
    [seasonMonth, place.scope, place.scopeKey]
  );
  return new Map(rows.rows.map((row) => [row.account_id, Number(row.peak)]));
};

/**
 * The two upserts, written out rather than assembled.
 *
 * `037` indexes weekly and final snapshots with two *partial* unique indexes,
 * because `week_start` is null on a final one and a null conflicts with
 * nothing. `ON CONFLICT` has to name the same columns and the same predicate as
 * the index it is targeting, and the two differ — so they are two statements
 * instead of one built by string concatenation, which is how the trailing comma
 * that broke the first version of this file got in.
 */
const SNAPSHOT_UPSERT: Readonly<Record<'weekly' | 'final', string>> = {
  weekly: `INSERT INTO territory_claim_season_snapshots (account_id, season_month, kind, scope,
       scope_key, week_start, total_area_sqm, peak_area_sqm, claim_count, rank,
       longest_held_days)
     VALUES ($1, $2, 'weekly', $3, $4, $5::date, $6, $7, $8, $9, $10)
     ON CONFLICT (account_id, season_month, scope, scope_key, week_start)
       WHERE kind = 'weekly'
     DO UPDATE SET total_area_sqm = EXCLUDED.total_area_sqm,
       peak_area_sqm = greatest(territory_claim_season_snapshots.peak_area_sqm,
         EXCLUDED.peak_area_sqm),
       claim_count = EXCLUDED.claim_count, rank = EXCLUDED.rank,
       longest_held_days = EXCLUDED.longest_held_days, taken_at = now()`,
  final: `INSERT INTO territory_claim_season_snapshots (account_id, season_month, kind, scope,
       scope_key, week_start, total_area_sqm, peak_area_sqm, claim_count, rank,
       longest_held_days)
     VALUES ($1, $2, 'final', $3, $4, $5::date, $6, $7, $8, $9, $10)
     ON CONFLICT (account_id, season_month, scope, scope_key)
       WHERE kind = 'final'
     DO UPDATE SET total_area_sqm = EXCLUDED.total_area_sqm,
       peak_area_sqm = greatest(territory_claim_season_snapshots.peak_area_sqm,
         EXCLUDED.peak_area_sqm),
       claim_count = EXCLUDED.claim_count, rank = EXCLUDED.rank,
       longest_held_days = EXCLUDED.longest_held_days, taken_at = now()`
};

export interface SnapshotRequest {
  seasonMonth: string;
  kind: 'weekly' | 'final';
  /** `YYYY-MM-DD` Kolkata Monday. Required for a weekly snapshot, absent on a final one. */
  weekStart?: string;
  now: Date;
}

/** What one snapshot pass produced, so a caller can notify from it. */
export interface SnapshotResult {
  rowsWritten: number;
  /** The global standing, the one board every account appears on. */
  globalStandings: TurfStanding[];
  /** An account's city standing, which is the one worth telling them about. */
  placeByAccount: Map<string, { cityTag: string; rank: number; totalAreaSqm: number }>;
}

/**
 * The standings as they stand right now, written nowhere.
 *
 * The three-day season warning needs a live rank, not the last weekly
 * snapshot: that snapshot can be six days old, and telling somebody they hold
 * rank #4 when they were carved out on Tuesday is the notice getting the one
 * fact it exists to convey wrong.
 *
 * Country boards are skipped because nothing reads a country rank from here —
 * only the global standing (who to tell) and the city rank (what to tell them).
 */
export const liveStandings = async (
  db: Queryable,
  seasonMonth: string,
  now: Date
): Promise<Pick<SnapshotResult, 'globalStandings' | 'placeByAccount'>> => {
  const places = await boardScopesFor(db, seasonMonth);
  let globalStandings: TurfStanding[] = [];
  const placeByAccount = new Map<string, { cityTag: string; rank: number; totalAreaSqm: number }>();

  for (const place of places) {
    if (place.scope === 'country') continue;
    const standings = turfStandings(await holdingsFor(db, seasonMonth, place, now));
    if (place.scope === 'global') {
      globalStandings = standings;
      continue;
    }
    for (const standing of standings) {
      placeByAccount.set(standing.accountId, {
        cityTag: place.scopeKey,
        rank: standing.rank,
        totalAreaSqm: standing.totalAreaSqm
      });
    }
  }

  return { globalStandings, placeByAccount };
};

/**
 * Freeze the standings for one season across every place.
 *
 * Idempotent by upsert on the snapshot's natural key, so running it twice in
 * the same week — or twice in the same second, which the five-second sweep
 * makes likely — overwrites rather than duplicates.
 */
export const writeSeasonSnapshots = async (
  db: Queryable,
  request: SnapshotRequest
): Promise<SnapshotResult> => {
  if (request.kind === 'weekly' && !request.weekStart)
    throw new Error('a weekly territory snapshot needs the week it covers');

  const places = await boardScopesFor(db, request.seasonMonth);
  let rowsWritten = 0;
  let globalStandings: TurfStanding[] = [];
  const placeByAccount = new Map<string, { cityTag: string; rank: number; totalAreaSqm: number }>();

  for (const place of places) {
    const holdings = await holdingsFor(db, request.seasonMonth, place, request.now);
    const standings = turfStandings(holdings);
    if (place.scope === 'global') globalStandings = standings;
    const peaks = await peaksFor(db, request.seasonMonth, place);

    for (const standing of standings) {
      // A peak carries forward from earlier snapshots in the same season, so a
      // runner who held 90,000 m² in week two and 20,000 m² at the end is
      // remembered by the 90,000. Without the weekly job a peak equals the
      // final total, which is correct and simply less interesting.
      const peak = peakAreaSqm(standing.totalAreaSqm, [peaks.get(standing.accountId) ?? 0]);
      await db.query(SNAPSHOT_UPSERT[request.kind], [
        standing.accountId,
        request.seasonMonth,
        place.scope,
        place.scopeKey,
        request.weekStart ?? null,
        standing.totalAreaSqm,
        peak,
        standing.claimCount,
        standing.rank,
        standing.longestHeldDays
      ]);
      rowsWritten += 1;

      // The city rank is the one worth telling somebody: a global rank in the
      // thousands says nothing they can act on.
      if (place.scope === 'city') {
        placeByAccount.set(standing.accountId, {
          cityTag: place.scopeKey,
          rank: standing.rank,
          totalAreaSqm: standing.totalAreaSqm
        });
      }
    }

    await updateHallOfFame(db, request.seasonMonth, place, standings);
  }

  return { rowsWritten, globalStandings, placeByAccount };
};

/**
 * Promote any record this standing beat.
 *
 * A tie does not beat a record, for the same reason a tie does not carve
 * ground: whoever got there first keeps it.
 */
export const updateHallOfFame = async (
  db: Queryable,
  seasonMonth: string,
  place: BoardScope,
  standings: readonly TurfStanding[]
): Promise<number> => {
  const candidates = hallOfFameCandidates(standings);
  if (candidates.length === 0) return 0;

  const standing = await db.query<{ record_type: string; value_sqm: number }>(
    `SELECT record_type, value_sqm FROM territory_claim_hall_of_fame
     WHERE scope = $1 AND scope_key = $2`,
    [place.scope, place.scopeKey]
  );
  const held = new Map(standing.rows.map((row) => [row.record_type, Number(row.value_sqm)]));

  let promoted = 0;
  for (const candidate of candidates) {
    if (!beatsRecord(candidate.valueSqm, held.get(candidate.recordType))) continue;
    // Display identity is copied in so the record still reads as a sentence
    // after the account is erased. Nothing else about the account is stored.
    const profile = await db.query<{ display_name: string | null }>(
      'SELECT display_name FROM profiles WHERE account_id = $1',
      [candidate.accountId]
    );
    await db.query(
      `INSERT INTO territory_claim_hall_of_fame (record_type, scope, scope_key, value_sqm,
         account_id, display_name, season_month, achieved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (record_type, scope, scope_key)
       DO UPDATE SET value_sqm = EXCLUDED.value_sqm, account_id = EXCLUDED.account_id,
         display_name = EXCLUDED.display_name, season_month = EXCLUDED.season_month,
         achieved_at = EXCLUDED.achieved_at
       WHERE territory_claim_hall_of_fame.value_sqm < EXCLUDED.value_sqm`,
      [
        candidate.recordType,
        place.scope,
        place.scopeKey,
        candidate.valueSqm,
        candidate.accountId,
        profile.rows[0]?.display_name ?? 'RunSphere member',
        seasonMonth
      ]
    );
    promoted += 1;
  }
  return promoted;
};
