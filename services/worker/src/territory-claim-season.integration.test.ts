import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seasonEndsAt, seasonMonthFor } from '@runsphere/domain';
import { processTerritoryGeoTags } from './territory-geo-backfill.js';
import { processTerritoryRanks, takeWeeklyRanks } from './territory-rank-job.js';
import {
  openCurrentSeason,
  processTerritorySeasonReset,
  resetSeason
} from './territory-season-reset-job.js';
import { processTerritorySeasonEnding } from './territory-season-ending-job.js';

/**
 * The Turf season loop against a real PostGIS (pending-work 2.5-2.8).
 *
 * These jobs are almost entirely SQL — two partial unique indexes, an upsert
 * that has to target the right one, a `greatest()` that carries a peak forward,
 * a constraint that has to permit a release with no successor. A fake database
 * that returns whatever the test tells it would assert none of that, and this
 * is where the interesting failures live: the first version of the migration
 * silently skipped creating its own tables because the H3 cell engine already
 * owned the name `territory_seasons`, and only applying it found that.
 *
 * Enable with `RUN_POSTGIS_INTEGRATION=1` and a `DATABASE_URL`. Skipped
 * otherwise, so the default `pnpm test` needs no database.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));

const BASE_LNG = 72.8777;
const BASE_LAT = 19.076;
const SEASON = seasonMonthFor(new Date());

let alice = '';
let bob = '';
let carol = '';

const makeAccount = async (displayName: string): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`season-${randomUUID()}@example.test`]
  );
  const id = created.rows[0]!.id;
  await db.query(
    `INSERT INTO profiles (account_id, display_name, cosmetic)
     VALUES ($1, $2, '{"avatarKey":"orbit-01"}'::jsonb)
     ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [id, displayName]
  );
  return id;
};

/** A square claim, `metres` on a side, offset east so tests do not overlap. */
const squarePolygon = (eastDegrees: number, metres: number): string => {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
  const lng = BASE_LNG + eastDegrees;
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lng, BASE_LAT],
        [lng + dLng, BASE_LAT],
        [lng + dLng, BASE_LAT + dLat],
        [lng, BASE_LAT + dLat],
        [lng, BASE_LAT]
      ]
    ]
  });
};

const insertClaim = async (
  owner: string,
  options: {
    eastDegrees: number;
    metres: number;
    areaSqm: number;
    city?: string | null;
    country?: string | null;
    claimedDaysAgo?: number;
    seasonMonth?: string;
  }
): Promise<string> => {
  const polygon = squarePolygon(options.eastDegrees, options.metres);
  const created = await db.query<{ id: string }>(
    `INSERT INTO territory_claims (account_id, boundary, centroid, area_sqm, distance_metres,
       duration_seconds, capture_count, lineage_id, season_month, city_tag, country_tag,
       continent_tag, claimed_at)
     VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
       ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), $3, 1200, 600, 1,
       gen_random_uuid(), $4, $5, $6, $7, now() - ($8 || ' days')::interval)
     RETURNING id`,
    [
      owner,
      polygon,
      options.areaSqm,
      options.seasonMonth ?? SEASON,
      options.city ?? null,
      options.country ?? null,
      options.city ? 'Asia' : null,
      String(options.claimedDaysAgo ?? 0)
    ]
  );
  return created.rows[0]!.id;
};

/**
 * Reset only this suite's own rows.
 *
 * Wholesale `DELETE FROM territory_claims` would take another suite's data with
 * it: CI runs the API and worker integration suites as separate turbo tasks
 * against one database, concurrently. The hall of fame and the season table are
 * not account-scoped, so those are still cleared whole — nothing else writes
 * them, and the Turf season tables exist for this mechanic alone.
 */
const clearSeasonData = async (): Promise<void> => {
  const mine = [[alice, bob, carol]];
  await db.query(
    'DELETE FROM territory_claim_season_snapshots WHERE account_id = ANY($1::uuid[])',
    mine
  );
  await db.query('DELETE FROM territory_claim_hall_of_fame');
  await db.query(
    "DELETE FROM notification_inbox WHERE kind = 'territory_season' AND account_id = ANY($1::uuid[])",
    mine
  );
  await db.query('DELETE FROM territory_claims WHERE account_id = ANY($1::uuid[])', mine);
  await db.query('DELETE FROM territory_claim_seasons');
};

const countNotices = async (accountId: string): Promise<number> => {
  const rows = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM notification_inbox WHERE account_id = $1 AND kind = 'territory_season'",
    [accountId]
  );
  return Number(rows.rows[0]?.count ?? 0);
};

const noticeFor = async (
  accountId: string
): Promise<{ body: string; deep_link: string | null } | undefined> => {
  const rows = await db.query<{ body: string; deep_link: string | null }>(
    `SELECT body, deep_link FROM notification_inbox
     WHERE account_id = $1 AND dedupe_key LIKE 'season-ending:%' LIMIT 1`,
    [accountId]
  );
  return rows.rows[0];
};

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  alice = await makeAccount('Alice');
  bob = await makeAccount('Bob');
  carol = await makeAccount('Carol');
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  if (alice) {
    await clearSeasonData();
    await db.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[alice, bob, carol]]);
  }
  await db.end();
});

beforeEach(async () => {
  if (!enabled) return;
  await clearSeasonData();
  await openCurrentSeason(db, new Date());
});

describePostgis('the Turf season loop on real PostGIS', () => {
  describe('the weekly rank job', () => {
    it('ranks a city, a country, and the world in one pass', async () => {
      await insertClaim(alice, {
        eastDegrees: 0.1,
        metres: 400,
        areaSqm: 50_000,
        city: 'Mumbai',
        country: 'IN'
      });
      await insertClaim(bob, {
        eastDegrees: 0.2,
        metres: 300,
        areaSqm: 30_000,
        city: 'Mumbai',
        country: 'IN'
      });
      // Untagged: counts worldwide and on no city board, which is the honest
      // treatment of ground whose place nobody knows.
      await insertClaim(carol, { eastDegrees: 0.3, metres: 500, areaSqm: 90_000 });

      const outcome = await takeWeeklyRanks(db, new Date());

      const global = await db.query<{ account_id: string; rank: number }>(
        `SELECT account_id, rank FROM territory_claim_season_snapshots
         WHERE kind = 'weekly' AND scope = 'global' ORDER BY rank`
      );
      expect(global.rows.map((row) => row.account_id)).toEqual([carol, alice, bob]);

      const city = await db.query<{ account_id: string; rank: number }>(
        `SELECT account_id, rank FROM territory_claim_season_snapshots
         WHERE kind = 'weekly' AND scope = 'city' AND scope_key = 'Mumbai' ORDER BY rank`
      );
      expect(city.rows.map((row) => row.account_id)).toEqual([alice, bob]);
      expect(city.rows.map((row) => Number(row.rank))).toEqual([1, 2]);

      const country = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claim_season_snapshots
         WHERE kind = 'weekly' AND scope = 'country' AND scope_key = 'IN'`
      );
      expect(Number(country.rows[0]!.count)).toBe(2);
      expect(outcome.rowsWritten).toBe(3 + 2 + 2);
    });

    it('is idempotent: a second pass overwrites rather than duplicating', async () => {
      await insertClaim(alice, {
        eastDegrees: 0.1,
        metres: 400,
        areaSqm: 50_000,
        city: 'Mumbai',
        country: 'IN'
      });

      await takeWeeklyRanks(db, new Date());
      await takeWeeklyRanks(db, new Date());

      // The partial unique index on (account, season, scope, key, week) is what
      // makes this true, and targeting the right one from `ON CONFLICT` is what
      // the first version of the upsert got wrong.
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claim_season_snapshots
         WHERE kind = 'weekly' AND account_id = $1 AND scope = 'global'`,
        [alice]
      );
      expect(Number(rows.rows[0]!.count)).toBe(1);
    });

    it('does nothing on a second sweep in the same week', async () => {
      await insertClaim(alice, { eastDegrees: 0.1, metres: 400, areaSqm: 50_000 });

      const first = await processTerritoryRanks({ db }, new Date());
      const second = await processTerritoryRanks({ db }, new Date());

      expect(first.rowsWritten).toBeGreaterThan(0);
      expect(second.rowsWritten).toBe(0);
    });

    it('carries a peak forward when ground is later lost', async () => {
      const big = await insertClaim(alice, { eastDegrees: 0.1, metres: 500, areaSqm: 90_000 });
      await takeWeeklyRanks(db, new Date('2026-09-07T00:00:00.000Z'));

      // They lose most of it, then a later week is recorded.
      await db.query(
        `UPDATE territory_claims SET released_at = now(), season_expired_at = now()
         WHERE id = $1`,
        [big]
      );
      await insertClaim(alice, { eastDegrees: 0.15, metres: 200, areaSqm: 10_000 });
      await takeWeeklyRanks(db, new Date('2026-09-14T00:00:00.000Z'));

      const peak = await db.query<{ peak: string }>(
        `SELECT max(peak_area_sqm)::text AS peak FROM territory_claim_season_snapshots
         WHERE account_id = $1 AND scope = 'global'`,
        [alice]
      );
      // The month is remembered by the 90,000, not by what survived.
      expect(Number(peak.rows[0]!.peak)).toBe(90_000);
    });

    it('tells each runner their own rank once', async () => {
      await insertClaim(alice, {
        eastDegrees: 0.1,
        metres: 400,
        areaSqm: 50_000,
        city: 'Mumbai',
        country: 'IN'
      });

      await takeWeeklyRanks(db, new Date());
      await takeWeeklyRanks(db, new Date());

      const inbox = await db.query<{ body: string }>(
        `SELECT body FROM notification_inbox
         WHERE account_id = $1 AND kind = 'territory_season'`,
        [alice]
      );
      expect(inbox.rows).toHaveLength(1);
      // The city rank, because a global rank in the thousands says nothing.
      expect(inbox.rows[0]!.body).toContain('Mumbai');
      expect(inbox.rows[0]!.body).toContain('#1');
    });

    it('leaves out a suspended account, as every other board does', async () => {
      await insertClaim(alice, { eastDegrees: 0.1, metres: 400, areaSqm: 50_000 });
      await insertClaim(bob, { eastDegrees: 0.2, metres: 400, areaSqm: 60_000 });
      const sanction = await db.query<{ id: string }>(
        `INSERT INTO sanctions (account_id, kind, reason, statement, issued_by_account_id)
         VALUES ($1, 'social_suspension', 'other', 'Paused after a report.', $2)
         RETURNING id`,
        [bob, alice]
      );

      try {
        await takeWeeklyRanks(db, new Date());
        const rows = await db.query<{ account_id: string }>(
          `SELECT account_id FROM territory_claim_season_snapshots WHERE scope = 'global'`
        );
        expect(rows.rows.map((row) => row.account_id)).toEqual([alice]);
      } finally {
        await db.query('DELETE FROM sanctions WHERE id = $1', [sanction.rows[0]!.id]);
      }
    });
  });

  describe('the monthly reset', () => {
    /** A finished month with ground held in it. */
    const finishedSeason = async (): Promise<string> => {
      const past = '2026-08';
      await db.query(
        `INSERT INTO territory_claim_seasons (season_month, started_at)
         VALUES ($1, now() - interval '40 days') ON CONFLICT DO NOTHING`,
        [past]
      );
      await insertClaim(alice, {
        eastDegrees: 0.4,
        metres: 500,
        areaSqm: 90_000,
        city: 'Mumbai',
        country: 'IN',
        claimedDaysAgo: 30,
        seasonMonth: past
      });
      await insertClaim(bob, {
        eastDegrees: 0.5,
        metres: 300,
        areaSqm: 30_000,
        city: 'Mumbai',
        country: 'IN',
        claimedDaysAgo: 20,
        seasonMonth: past
      });
      return past;
    };

    it('snapshots, archives, records, and notifies', async () => {
      const past = await finishedSeason();

      const outcome = await resetSeason(db, past, new Date());

      expect(outcome.claimsArchived).toBe(2);

      // The final standing was taken from live claims, before archiving.
      const final = await db.query<{ account_id: string; rank: number; peak: string }>(
        `SELECT account_id, rank, peak_area_sqm::text AS peak
         FROM territory_claim_season_snapshots
         WHERE season_month = $1 AND kind = 'final' AND scope = 'city'
         ORDER BY rank`,
        [past]
      );
      expect(final.rows.map((row) => row.account_id)).toEqual([alice, bob]);
      expect(Number(final.rows[0]!.peak)).toBe(90_000);

      // Every claim released, with the month named as the reason rather than a
      // successor claim invented to satisfy a constraint.
      const archived = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claims
         WHERE season_month = $1 AND released_at IS NOT NULL
           AND season_expired_at IS NOT NULL AND released_to_claim_id IS NULL`,
        [past]
      );
      expect(Number(archived.rows[0]!.count)).toBe(2);

      // Nothing deleted.
      const kept = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claims WHERE season_month = $1`,
        [past]
      );
      expect(Number(kept.rows[0]!.count)).toBe(2);

      const season = await db.query<{ ended: boolean; reset: boolean; archived: number }>(
        `SELECT ended_at IS NOT NULL AS ended, reset_at IS NOT NULL AS reset, claims_archived
         FROM territory_claim_seasons WHERE season_month = $1`,
        [past]
      );
      expect(season.rows[0]).toMatchObject({ ended: true, reset: true, claims_archived: 2 });

      const inbox = await db.query<{ body: string }>(
        `SELECT body FROM notification_inbox
         WHERE account_id = $1 AND kind = 'territory_season'`,
        [alice]
      );
      expect(inbox.rows).toHaveLength(1);
      expect(inbox.rows[0]!.body).toContain('90,000');
      expect(inbox.rows[0]!.body).toContain('#1');
    });

    it('sets the hall of fame from the season it closed', async () => {
      const past = await finishedSeason();

      await resetSeason(db, past, new Date());

      const records = await db.query<{
        record_type: string;
        value_sqm: number;
        display_name: string;
      }>(
        `SELECT record_type, value_sqm, display_name FROM territory_claim_hall_of_fame
         WHERE scope = 'city' AND scope_key = 'Mumbai' ORDER BY record_type`
      );
      expect(records.rows).toHaveLength(2);
      expect(records.rows.map((row) => row.record_type)).toEqual([
        'largest_claim',
        'largest_holding'
      ]);
      expect(records.rows.every((row) => row.display_name === 'Alice')).toBe(true);
    });

    it('does not lower a record a later season failed to beat', async () => {
      const past = await finishedSeason();
      await resetSeason(db, past, new Date());

      // A quieter month, then its reset.
      const quiet = '2026-09';
      await db.query(
        `INSERT INTO territory_claim_seasons (season_month, started_at)
         VALUES ($1, now() - interval '10 days') ON CONFLICT DO NOTHING`,
        [quiet]
      );
      await insertClaim(bob, {
        eastDegrees: 0.6,
        metres: 200,
        areaSqm: 10_000,
        city: 'Mumbai',
        country: 'IN',
        seasonMonth: quiet
      });
      await resetSeason(db, quiet, new Date());

      const record = await db.query<{ value_sqm: number; display_name: string }>(
        `SELECT value_sqm, display_name FROM territory_claim_hall_of_fame
         WHERE scope = 'city' AND scope_key = 'Mumbai' AND record_type = 'largest_holding'`
      );
      // A record is beaten or it stands; it is never replaced by a smaller one.
      expect(Number(record.rows[0]!.value_sqm)).toBe(90_000);
      expect(record.rows[0]!.display_name).toBe('Alice');
    });

    it('is idempotent: a second reset of the same month changes nothing', async () => {
      const past = await finishedSeason();

      const first = await resetSeason(db, past, new Date());
      const second = await resetSeason(db, past, new Date());

      expect(first.claimsArchived).toBe(2);
      // The season is already closed, so the second pass claims nothing.
      expect(second.claimsArchived).toBe(0);

      const inbox = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notification_inbox
         WHERE kind = 'territory_season' AND account_id = $1`,
        [alice]
      );
      expect(Number(inbox.rows[0]!.count)).toBe(1);
    });

    it('leaves the month being played alone', async () => {
      await insertClaim(alice, { eastDegrees: 0.1, metres: 400, areaSqm: 50_000 });

      const outcome = await processTerritorySeasonReset({ db }, new Date());

      expect(outcome.seasonsReset).toBe(0);
      // Scoped to this suite's own accounts. CI runs the API and worker
      // integration suites as separate turbo tasks against one database, so an
      // unscoped count sees claims another suite created and this asserted 3
      // where it meant 1.
      const live = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM territory_claims
         WHERE released_at IS NULL AND account_id = ANY($1::uuid[])`,
        [[alice, bob, carol]]
      );
      expect(Number(live.rows[0]!.count)).toBe(1);
    });

    it('closes two missed months, oldest first', async () => {
      // A worker that was off for two months resets both rather than leaving
      // the older one open forever.
      for (const month of ['2026-07', '2026-08']) {
        await db.query(
          `INSERT INTO territory_claim_seasons (season_month, started_at)
           VALUES ($1, now() - interval '80 days') ON CONFLICT DO NOTHING`,
          [month]
        );
        await insertClaim(alice, {
          eastDegrees: month === '2026-07' ? 0.7 : 0.8,
          metres: 300,
          areaSqm: 30_000,
          seasonMonth: month
        });
      }

      const outcome = await processTerritorySeasonReset({ db }, new Date());

      expect(outcome.seasonsReset).toBe(2);
      const open = await db.query<{ season_month: string }>(
        `SELECT season_month FROM territory_claim_seasons WHERE ended_at IS NULL`
      );
      expect(open.rows.map((row) => row.season_month)).toEqual([SEASON]);
    });

    it('opens the month being played on every sweep', async () => {
      await db.query('DELETE FROM territory_claim_seasons');

      await processTerritorySeasonReset({ db }, new Date());

      const open = await db.query<{ season_month: string }>(
        `SELECT season_month FROM territory_claim_seasons WHERE ended_at IS NULL`
      );
      expect(open.rows.map((row) => row.season_month)).toEqual([SEASON]);
    });
  });

  describe('geo tags', () => {
    it('tags a Mumbai claim from the seeded cells, with no geocoder at all', async () => {
      // The launch market works offline: `038` seeded 104 resolution-6 cells
      // covering MMR, so this needs no provider and makes no network call.
      await insertClaim(alice, { eastDegrees: 0, metres: 400, areaSqm: 50_000, city: null });

      const outcome = await processTerritoryGeoTags({ db }, new Date());

      expect(outcome.tagged).toBe(1);
      expect(outcome.geocoded).toBe(0);
      const tagged = await db.query<{ city_tag: string; country_tag: string }>(
        `SELECT city_tag, country_tag FROM territory_claims WHERE account_id = $1`,
        [alice]
      );
      expect(tagged.rows[0]).toMatchObject({ city_tag: 'Mumbai', country_tag: 'IN' });
    });

    it('leaves a claim outside the seeded market untagged rather than wrong', async () => {
      // London: no seeded cell, no configured geocoder. The ground is held and
      // counts worldwide; nobody claims to know which city it is in.
      await db.query(
        `INSERT INTO territory_claims (account_id, boundary, centroid, area_sqm,
           distance_metres, duration_seconds, capture_count, lineage_id, season_month)
         VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
           ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), 50000, 1200, 600, 1,
           gen_random_uuid(), $3)`,
        [
          carol,
          JSON.stringify({
            type: 'Polygon',
            coordinates: [
              [
                [-0.12, 51.5],
                [-0.115, 51.5],
                [-0.115, 51.505],
                [-0.12, 51.505],
                [-0.12, 51.5]
              ]
            ]
          }),
          SEASON
        ]
      );

      const outcome = await processTerritoryGeoTags({ db }, new Date());

      expect(outcome.tagged).toBe(0);
      const untagged = await db.query<{ city_tag: string | null }>(
        `SELECT city_tag FROM territory_claims WHERE account_id = $1`,
        [carol]
      );
      expect(untagged.rows[0]!.city_tag).toBeNull();
    });

    it('refuses a claim tagged with a country but no city', async () => {
      // Half a geocode is worse than none: it would sit on a country board
      // while being invisible on every city board.
      const id = await insertClaim(alice, {
        eastDegrees: 0.9,
        metres: 300,
        areaSqm: 30_000,
        city: 'Mumbai',
        country: 'IN'
      });

      await expect(
        db.query('UPDATE territory_claims SET city_tag = NULL WHERE id = $1', [id])
      ).rejects.toThrow(/geo_tags_together/);
    });
  });
});

describePostgis('the three-day season warning', () => {
  /** Somewhere inside the warning window for the season the claims are in. */
  const daysBeforeClose = (days: number): Date =>
    new Date(seasonEndsAt(new Date()).getTime() - days * 86_400_000);

  beforeEach(clearSeasonData);

  it('says nothing until the last three days', async () => {
    await insertClaim(alice, {
      eastDegrees: 3.0,
      metres: 300,
      areaSqm: 30_000,
      city: 'Mumbai',
      country: 'IN'
    });

    expect(await processTerritorySeasonEnding({ db }, daysBeforeClose(10))).toBeUndefined();
    expect(await countNotices(alice)).toBe(0);
  });

  it('tells everyone holding ground, with their city rank', async () => {
    await insertClaim(alice, {
      eastDegrees: 3.1,
      metres: 400,
      areaSqm: 40_000,
      city: 'Mumbai',
      country: 'IN'
    });
    await insertClaim(bob, {
      eastDegrees: 3.2,
      metres: 300,
      areaSqm: 30_000,
      city: 'Mumbai',
      country: 'IN'
    });
    await processTerritoryGeoTags({ db }, new Date());

    const outcome = await processTerritorySeasonEnding({ db }, daysBeforeClose(2));

    expect(outcome?.notificationsQueued).toBe(2);
    expect(outcome?.daysRemaining).toBe(2);
    const notice = await noticeFor(alice);
    expect(notice?.body).toContain('Season ends in 2 days');
    // Alice holds more, so she is #1 in Mumbai.
    expect(notice?.body).toContain('rank #1');
    expect(notice?.body).toContain('40,000 m²');
    expect(notice?.deep_link).toBe(`runsphere://turf/season/${SEASON}`);
    expect((await noticeFor(bob))?.body).toContain('rank #2');
  });

  it('says nothing to somebody holding nothing', async () => {
    await insertClaim(alice, {
      eastDegrees: 3.3,
      metres: 300,
      areaSqm: 30_000,
      city: 'Mumbai',
      country: 'IN'
    });

    await processTerritorySeasonEnding({ db }, daysBeforeClose(2));

    // The copy is "You hold rank #N with Xm²", which is not a sentence you can
    // write for carol.
    expect(await countNotices(carol)).toBe(0);
  });

  it('tells nobody twice, however many sweeps run', async () => {
    await insertClaim(alice, {
      eastDegrees: 3.4,
      metres: 300,
      areaSqm: 30_000,
      city: 'Mumbai',
      country: 'IN'
    });

    // The sweep runs every five seconds for three days. Without the unique
    // index from `042` this is thousands of notices.
    expect(
      (await processTerritorySeasonEnding({ db }, daysBeforeClose(3)))?.notificationsQueued
    ).toBe(1);
    expect(
      (await processTerritorySeasonEnding({ db }, daysBeforeClose(2)))?.notificationsQueued
    ).toBe(0);
    expect(
      (await processTerritorySeasonEnding({ db }, daysBeforeClose(1)))?.notificationsQueued
    ).toBe(0);
    expect(await countNotices(alice)).toBe(1);
  });

  it('does not collide with the season result, which points at the same place', async () => {
    // Both notices deep-link to `runsphere://turf/season/<month>`. The old
    // read-back guard keyed on the link and would have suppressed one of them.
    await insertClaim(alice, {
      eastDegrees: 3.5,
      metres: 300,
      areaSqm: 30_000,
      city: 'Mumbai',
      country: 'IN'
    });
    await openCurrentSeason(db, new Date());

    await processTerritorySeasonEnding({ db }, daysBeforeClose(2));
    await resetSeason(db, SEASON, new Date());

    expect(await countNotices(alice)).toBe(2);
    const keys = await db.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM notification_inbox
       WHERE account_id = $1 ORDER BY dedupe_key`,
      [alice]
    );
    expect(keys.rows.map((row) => row.dedupe_key)).toEqual([
      `season-ended:${SEASON}`,
      `season-ending:${SEASON}`
    ]);
  });
});

/**
 * A gated suite that quietly does not run is a green tick that means nothing.
 * This is the one test in the file that always runs, and in CI it fails if the
 * rest were skipped.
 */
describe('the PostGIS gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
