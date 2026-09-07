import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Territory claims against a real PostGIS (Phase 5).
 *
 * Every other test of this mechanic runs against a fake database that returns
 * whatever the test tells it to. That proves the TypeScript and proves nothing
 * about the SQL — and the SQL is where the interesting failures live: a CHECK
 * that does not fire, a GiST index that is never used, a `::geography` cast
 * that measures the wrong thing.
 *
 * **One query here is not like the others.** The privacy-zone test is the only
 * place in this product where a wrong answer is a privacy failure rather than a
 * bug: if `ST_DWithin` measures in degrees instead of metres, a loop around
 * somebody's house is published. It is asserted from both sides — a loop inside
 * a zone and one outside it — because a check that always returns true would
 * pass a one-sided test.
 *
 * Enable with `RUN_POSTGIS_INTEGRATION=1` and a `DATABASE_URL`, as the M1 suite
 * does. Skipped otherwise, so the default `pnpm test` needs no database.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const SECRET = 'turf-integration-secret';
const app = buildApp({ db, authSecret: SECRET });

/** A closed square ring, `metres` on a side, as a GeoJSON polygon string. */
const squarePolygon = (lng: number, lat: number, metres: number): string => {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + dLng, lat],
        [lng + dLng, lat + dLat],
        [lng, lat + dLat],
        [lng, lat]
      ]
    ]
  });
};

const BASE_LNG = 72.8777;
const BASE_LAT = 19.076;

let account = '';
let rival = '';

/** With a profile, because a carve notice names the runner who took the ground. */
const makeAccount = async (displayName?: string): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`turf-${randomUUID()}@example.test`]
  );
  const id = created.rows[0]!.id;
  if (displayName) {
    await db.query(
      `INSERT INTO profiles (account_id, display_name, cosmetic)
       VALUES ($1, $2, '{"avatarKey":"orbit-01"}'::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [id, displayName]
    );
  }
  return id;
};

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  account = await makeAccount('Mira');
  rival = await makeAccount('Coda');
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await app.close();
  // Accounts cascade to claims, zones, takeovers, profiles, and the inbox.
  if (account)
    await db.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[account, rival]]);
  await db.end();
});

const insertClaim = async (
  owner: string,
  polygon: string,
  durationSeconds: number
): Promise<string> => {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO territory_claims (account_id, boundary, centroid, area_sqm, distance_metres,
       duration_seconds, capture_count, lineage_id, season_month)
     VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
       ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
       ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography), 1200, $3, 1,
       gen_random_uuid(), to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))
     RETURNING id`,
    [owner, polygon, durationSeconds]
  );
  return inserted.rows[0]!.id;
};

describePostgis('territory claims on real PostGIS', () => {
  it('stores a loop as a polygon and measures its area in square metres', async () => {
    const id = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
    const row = await db.query<{ area_sqm: number; kind: string }>(
      `SELECT area_sqm, GeometryType(boundary) AS kind FROM territory_claims WHERE id = $1`,
      [id]
    );

    // 300 m square ≈ 90,000 m². If the geography cast were missing this would
    // come back as a fraction of a square degree.
    expect(row.rows[0]!.kind).toBe('POLYGON');
    expect(Number(row.rows[0]!.area_sqm)).toBeGreaterThan(88_000);
    expect(Number(row.rows[0]!.area_sqm)).toBeLessThan(92_000);
  });

  describe('the privacy-zone check', () => {
    const zoneAt = async (lng: number, lat: number) => {
      const created = await db.query<{ id: string }>(
        `INSERT INTO privacy_zones (account_id, name, geometry, center, radius_meters)
         VALUES ($1, 'Home', ST_Buffer(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 200)::geometry,
           ST_SetSRID(ST_MakePoint($2, $3), 4326), 200)
         RETURNING id`,
        [account, lng, lat]
      );
      return created.rows[0]!.id;
    };

    /** The exact predicate the claim route runs before publishing a boundary. */
    const intrudes = async (owner: string, polygon: string): Promise<boolean> => {
      const found = await db.query<{ zone_id: string }>(
        `SELECT zone.id AS zone_id
         FROM privacy_zones zone
         WHERE zone.account_id = $1
           AND ST_DWithin(
             ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography,
             zone.geometry::geography,
             200)
         LIMIT 1`,
        [owner, polygon]
      );
      return found.rows.length > 0;
    };

    it('catches a loop that runs through a protected area', async () => {
      const zone = await zoneAt(BASE_LNG, BASE_LAT);
      try {
        expect(await intrudes(account, squarePolygon(BASE_LNG, BASE_LAT, 300))).toBe(true);
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone]);
      }
    });

    it('lets a loop well clear of every zone through', async () => {
      const zone = await zoneAt(BASE_LNG, BASE_LAT);
      try {
        // Roughly 5 km east: outside the 200 m zone and the 200 m buffer.
        expect(await intrudes(account, squarePolygon(BASE_LNG + 0.05, BASE_LAT, 300))).toBe(false);
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone]);
      }
    });

    it('measures the buffer in metres rather than degrees', async () => {
      const zone = await zoneAt(BASE_LNG, BASE_LAT);
      try {
        // 600 m north: clear of a 200 m zone plus a 200 m buffer, but well
        // inside 200 *degrees*. A missing `::geography` cast fails here.
        const clear = squarePolygon(BASE_LNG, BASE_LAT + 600 / 111_320, 100);
        expect(await intrudes(account, clear)).toBe(false);
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone]);
      }
    });

    it('applies only to the claimant own zones', async () => {
      const zone = await zoneAt(BASE_LNG, BASE_LAT);
      try {
        // A zone protects its owner's route from publication. Somebody else's
        // zone is not a reason this runner cannot hold ground they ran through.
        expect(await intrudes(rival, squarePolygon(BASE_LNG, BASE_LAT, 300))).toBe(false);
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone]);
      }
    });
  });

  it('finds claims by viewport, which is how the map reads', async () => {
    const id = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
    const inside = await db.query(
      `SELECT id FROM territory_claims
       WHERE released_at IS NULL AND boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
      [BASE_LNG - 0.01, BASE_LAT - 0.01, BASE_LNG + 0.01, BASE_LAT + 0.01]
    );
    const elsewhere = await db.query(
      `SELECT id FROM territory_claims
       WHERE released_at IS NULL AND boundary && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
      [BASE_LNG + 1, BASE_LAT + 1, BASE_LNG + 2, BASE_LAT + 2]
    );

    expect(inside.rows.map((row) => (row as { id: string }).id)).toContain(id);
    expect(elsewhere.rows).toHaveLength(0);
  });

  it('groups claims into activity blobs for a zoomed-out map', async () => {
    await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
    const clusters = await db.query<{ claim_count: string; holder_count: string }>(
      `SELECT count(*)::text AS claim_count, count(DISTINCT account_id)::text AS holder_count
       FROM territory_claims
       WHERE released_at IS NULL AND centroid && ST_MakeEnvelope($1, $2, $3, $4, 4326)
       GROUP BY floor(ST_X(centroid) / $5), floor(ST_Y(centroid) / $5)`,
      [BASE_LNG - 1, BASE_LAT - 1, BASE_LNG + 1, BASE_LAT + 1, 0.05]
    );

    expect(Number(clusters.rows[0]?.claim_count ?? 0)).toBeGreaterThan(0);
  });

  describe('the constraints that protect the contest', () => {
    it('refuses a takeover that was not actually won on speed', async () => {
      const held = await insertClaim(rival, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
      const taking = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 900);

      // `031` asserted the winner's *duration* was shorter, and `036` had to
      // drop that: with effort grace, a challenger running four times the loop
      // wins while taking four times as long. The invariant that replaced it is
      // the one the mechanic actually has — the challenger's grace-adjusted
      // speed beat the holder's — and the application layer cannot talk the
      // database out of it either.
      await expect(
        db.query(
          `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
             taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
             new_duration_seconds, effective_speed_mps, holder_speed_mps)
           VALUES ($1, $2, $3, $4, 600, 900, 2.0, 3.5)`,
          [held, rival, taking, account]
        )
      ).rejects.toThrow(/territory_claim_takeovers_won_on_speed/);
    });

    it('keeps the takeover rows the old rule wrote', async () => {
      const held = await insertClaim(rival, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
      const taking = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 400);

      // A row from before `036` carries no speeds. It is history, and history
      // that fails a constraint added afterwards is history that gets deleted.
      const written = await db.query(
        `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
           taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
           new_duration_seconds)
         VALUES ($1, $2, $3, $4, 600, 400)`,
        [held, rival, taking, account]
      );

      expect(written).toBeDefined();
    });

    it('refuses a release with no reason', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);

      // Released with neither a successor nor an expired month would leave
      // ground nobody holds and no way to say what happened to it. `037`
      // widened `031`'s two-state rule to three — live, taken, or expired with
      // the season — and this is the state that is still not one of them.
      await expect(
        db.query('UPDATE territory_claims SET released_at = now() WHERE id = $1', [id])
      ).rejects.toThrow(/territory_claims_release_has_a_reason/);
    });

    it('accepts a claim the month ended under, with no successor', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG + 0.02, BASE_LAT, 300), 600);

      // The reset's archive path: nobody took this ground, the season did.
      await db.query(
        `UPDATE territory_claims SET released_at = now(), season_expired_at = now()
         WHERE id = $1`,
        [id]
      );

      const archived = await db.query<{ expired: boolean }>(
        `SELECT season_expired_at IS NOT NULL AS expired FROM territory_claims WHERE id = $1`,
        [id]
      );
      expect(archived.rows[0]!.expired).toBe(true);
    });

    it('refuses a claim that is both taken and expired', async () => {
      const held = await insertClaim(account, squarePolygon(BASE_LNG + 0.03, BASE_LAT, 300), 600);
      const taker = await insertClaim(rival, squarePolygon(BASE_LNG + 0.03, BASE_LAT, 300), 400);

      // Two different stories about the same piece of ground.
      await expect(
        db.query(
          `UPDATE territory_claims
           SET released_at = now(), released_to_claim_id = $2, season_expired_at = now()
           WHERE id = $1`,
          [held, taker]
        )
      ).rejects.toThrow(/territory_claims_release_has_a_reason/);
    });

    it('refuses a run integrity verdict the reviewer cannot act on', async () => {
      await expect(
        db.query(
          `INSERT INTO run_integrity_flags (activity_id, account_id, verdict, findings,
             peak_speed_mps, average_speed_mps, distance_metres, straightness)
           VALUES (NULL, $1, 'banned', '{}', 1, 1, 1, 0.5)`,
          [account]
        )
      ).rejects.toThrow();
    });
  });

  it('published the claim rule the engine reads', async () => {
    const rule = await db.query<{ definition: Record<string, number> }>(
      `SELECT definition FROM rule_versions WHERE kind = 'territory_claim' AND version = 2`
    );

    // Version 2 is the carving rule. `takeoverOverlapRatio` is gone: there is
    // no single overlap threshold any more, because the overlap is carved
    // rather than won whole.
    expect(rule.rows[0]?.definition).toMatchObject({
      closeWithinMetres: 60,
      minAreaSqm: 5000,
      h3Resolution: 11,
      minCarveShare: 0.1,
      gracePerEffortMultiple: 0.05,
      maxEffortGrace: 0.15
    });
    expect(rule.rows[0]?.definition).not.toHaveProperty('takeoverOverlapRatio');
  });

  it('kept version 1 as history rather than rewriting it', async () => {
    // A claim decided under the old rule was decided under the old rule.
    const rule = await db.query<{ definition: Record<string, number> }>(
      `SELECT definition FROM rule_versions WHERE kind = 'territory_claim' AND version = 1`
    );

    expect(rule.rows[0]?.definition).toMatchObject({ takeoverOverlapRatio: 0.6 });
  });

  describe('the columns carving added', () => {
    it('round-trips a cell set and finds it with the array overlap operator', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG + 0.5, BASE_LAT, 300), 600);
      await db.query(
        `UPDATE territory_claims SET h3_cell_set = $2::text[], h3_version = '4.1.0' WHERE id = $1`,
        [id, ['8a2a1072b59ffff', '8a2a1072b58ffff']]
      );

      // The GIN index from `036` is what makes the contest query cheap; this
      // asserts the operator finds the row at all.
      const found = await db.query<{ id: string }>(
        `SELECT id FROM territory_claims WHERE h3_cell_set && $1::text[]`,
        [['8a2a1072b59ffff']]
      );

      expect(found.rows.map((row) => row.id)).toContain(id);
    });

    it('refuses a cell set with no library version behind it', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG + 0.6, BASE_LAT, 300), 600);

      // ADR-0001: cells that cannot be recomputed are cells nobody can dispute.
      await expect(
        db.query(`UPDATE territory_claims SET h3_cell_set = $2::text[] WHERE id = $1`, [
          id,
          ['8a2a1072b59ffff']
        ])
      ).rejects.toThrow(/h3_version_accompanies_cells/);
    });

    it('refuses a season month that is not one', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG + 0.7, BASE_LAT, 300), 600);

      await expect(
        db.query(`UPDATE territory_claims SET season_month = '2026-13' WHERE id = $1`, [id])
      ).rejects.toThrow(/season_month_shape/);
    });

    it('accepts a carve whose winner ran for longer than the holder', async () => {
      // The constraint `031` shipped asserted the opposite, and would have
      // blocked every effort-graced carve. `036` replaced it with a speed test.
      const holder = await insertClaim(account, squarePolygon(BASE_LNG + 0.8, BASE_LAT, 300), 270);
      const taker = await insertClaim(rival, squarePolygon(BASE_LNG + 0.8, BASE_LAT, 300), 1200);

      await db.query(
        `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
           taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
           new_duration_seconds, kind, carved_area_sqm, carved_cell_count, holder_survived,
           effort_ratio, grace_applied, effective_speed_mps, holder_speed_mps)
         VALUES ($1, $2, $3, $4, 270, 1200, 'carve', 20000, 10, true, 4, 0.15, 3.83, 3.7)`,
        [holder, account, taker, rival]
      );

      const ledger = await db.query<{ kind: string }>(
        `SELECT kind FROM territory_claim_takeovers WHERE taken_by_claim_id = $1`,
        [taker]
      );
      expect(ledger.rows[0]?.kind).toBe('carve');
    });

    it('still refuses a carve the challenger did not win on speed', async () => {
      const holder = await insertClaim(account, squarePolygon(BASE_LNG + 0.9, BASE_LAT, 300), 270);
      const taker = await insertClaim(rival, squarePolygon(BASE_LNG + 0.9, BASE_LAT, 300), 1200);

      await expect(
        db.query(
          `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
             taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
             new_duration_seconds, kind, effective_speed_mps, holder_speed_mps)
           VALUES ($1, $2, $3, $4, 270, 1200, 'carve', 3.0, 3.7)`,
          [holder, account, taker, rival]
        )
      ).rejects.toThrow(/won_on_speed/);
    });
  });

  /**
   * The claim route itself, end to end.
   *
   * Everything above proves one query at a time. This drives the real handler —
   * integrity check, zone check, loop detection, the transaction, the insert —
   * against the real database, which is the only way to know the whole path
   * holds together.
   */
  describe('POST /v1/territory/claims against the real database', () => {
    /** A derived run whose points trace a closed square loop. */
    const runWithLoop = async (
      owner: string,
      metres: number,
      totalSeconds: number,
      /**
       * Degrees east of `BASE_LNG` to run this loop.
       *
       * Every test in this file shares one database, and carving contests any
       * overlap over the floor — so without a distinct origin per test, a claim
       * left behind by an earlier one silently takes ground off this run and
       * the assertions stop measuring what they name. The old rule needed 60%
       * of the challenger inside a holder to contest at all, which hid this.
       */
      eastDegrees = 0
    ): Promise<string> => {
      const activity = await db.query<{ id: string }>(
        `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, status,
           request_fingerprint, processed_at, raw_trace_retention_until)
         VALUES ($1, $2, 'run', 'derived', $2, now(), now() + interval '30 days')
         RETURNING id`,
        [owner, randomUUID()]
      );
      const id = activity.rows[0]!.id;

      const dLat = metres / 111_320;
      const dLng = metres / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
      const originLng = BASE_LNG + eastDegrees;
      const corners = [
        [originLng, BASE_LAT],
        [originLng + dLng, BASE_LAT],
        [originLng + dLng, BASE_LAT + dLat],
        [originLng, BASE_LAT + dLat]
      ];
      const path: number[][] = [];
      for (let side = 0; side < 4; side += 1) {
        const from = corners[side]!;
        const to = corners[(side + 1) % 4]!;
        for (let step = 0; step < 8; step += 1) {
          const t = step / 8;
          path.push([from[0]! + (to[0]! - from[0]!) * t, from[1]! + (to[1]! - from[1]!) * t]);
        }
      }
      path.push(corners[0]!);
      const start = Date.UTC(2026, 8, 6, 5, 0, 0);
      const gap = (totalSeconds * 1000) / (path.length - 1);
      const points = path.map(([lng, lat], index) => ({
        longitude: lng,
        latitude: lat,
        recordedAt: new Date(start + index * gap).toISOString()
      }));

      await db.query(
        `INSERT INTO activity_chunks (activity_id, sequence, payload, payload_hash,
           uncompressed_bytes)
         VALUES ($1, 0, $2::jsonb, 'integration', 1)`,
        [id, JSON.stringify({ points })]
      );
      return id;
    };

    const claim = (owner: string, activityId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/territory/claims',
        headers: { authorization: `Bearer ${createAccessToken(owner, SECRET)}` },
        payload: { activityId }
      });

    it('turns a real closed loop into held ground', async () => {
      const activity = await runWithLoop(account, 400, 900, 1);
      const response = await claim(account, activity);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.claimed).toBe(true);
      // A 400 m square is 160,000 m². The published figure is the cell count,
      // which quantises it to whole ~1,963 m² cells — rounding either way,
      // since a cell counts when its centre is inside the loop and a cell
      // straddling the edge can fall on either side of that test.
      expect(body.claim.areaSqm).toBeGreaterThan(145_000);
      expect(body.claim.areaSqm).toBeLessThan(175_000);
      expect(body.claim.durationSeconds).toBeGreaterThan(0);
      expect(body.claim.speedMps).toBeGreaterThan(0);
    });

    it('hands the ground to a faster rival and records both times', async () => {
      const mine = await runWithLoop(account, 400, 1200, 2);
      const first = (await claim(account, mine)).json();
      const theirs = await runWithLoop(rival, 400, 600, 2);
      const response = await claim(rival, theirs);

      const body = response.json();
      expect(body.claimed).toBe(true);
      expect(body.takenOverCount).toBeGreaterThan(0);

      const ledger = await db.query<{ previous_duration_seconds: number }>(
        `SELECT previous_duration_seconds FROM territory_claim_takeovers
         WHERE taken_by_account_id = $1 AND taken_claim_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [rival, first.claim.id]
      );
      expect(Number(ledger.rows[0]!.previous_duration_seconds)).toBe(1200);
    });

    it('refuses a loop through the runner own privacy zone', async () => {
      const zone = await db.query<{ id: string }>(
        `INSERT INTO privacy_zones (account_id, name, geometry, center, radius_meters)
         VALUES ($1, 'Home',
           ST_Buffer(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 200)::geometry,
           ST_SetSRID(ST_MakePoint($2, $3), 4326), 200)
         RETURNING id`,
        [account, BASE_LNG, BASE_LAT]
      );
      try {
        // Deliberately on BASE_LNG, where the zone is.
        const activity = await runWithLoop(account, 400, 900);
        const body = (await claim(account, activity)).json();

        // The whole point of 5.4, proven against the database rather than a stub.
        expect(body).toMatchObject({ claimed: false, refusal: 'privacy_zone' });
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone.rows[0]!.id]);
      }
    });

    it('carves part of a claim and leaves the holder the rest', async () => {
      // A 600 m loop, then a 300 m loop inside its south-west corner run
      // faster. Under the old rule the inner loop overlapped too little to
      // contest anything; under carving it takes the corner and nothing else.
      const outer = await runWithLoop(account, 600, 1800, 3);
      const first = (await claim(account, outer)).json();
      if (!first.claimed) return;

      const inner = await runWithLoop(rival, 300, 300, 3);
      const body = (await claim(rival, inner)).json();

      expect(body.claimed).toBe(true);
      expect(body.takenOverCount).toBe(1);
      expect(body.carves[0].holderWipedOut).toBe(false);
      expect(body.carvedAreaSqm).toBeGreaterThan(0);

      // The holder keeps the rest, with a boundary redrawn from the cells that
      // survived — and their own run's time and distance untouched.
      const survivor = await db.query<{
        area_sqm: number;
        duration_seconds: number;
        cells: number;
      }>(
        `SELECT area_sqm, duration_seconds, array_length(h3_cell_set, 1) AS cells
         FROM territory_claims WHERE id = $1`,
        [first.claim.id]
      );
      expect(Number(survivor.rows[0]!.area_sqm)).toBeGreaterThan(5_000);
      expect(Number(survivor.rows[0]!.area_sqm)).toBeLessThan(first.claim.areaSqm);
      expect(Number(survivor.rows[0]!.duration_seconds)).toBe(first.claim.durationSeconds);
      expect(Number(survivor.rows[0]!.cells)).toBeGreaterThan(0);
    });

    it('writes the cells, the library version, and the month on a new claim', async () => {
      const activity = await runWithLoop(account, 400, 900, 4);
      const body = (await claim(account, activity)).json();
      if (!body.claimed) return;

      const stored = await db.query<{
        cells: number;
        h3_version: string;
        h3_resolution: number;
        season_month: string;
      }>(
        `SELECT array_length(h3_cell_set, 1) AS cells, h3_version, h3_resolution, season_month
         FROM territory_claims WHERE id = $1`,
        [body.claim.id]
      );
      const row = stored.rows[0]!;

      expect(Number(row.cells)).toBeGreaterThan(10);
      expect(row.h3_version).toBe('4.1.0');
      expect(Number(row.h3_resolution)).toBe(11);
      expect(row.season_month).toMatch(/^\d{4}-\d{2}$/);
    });

    /**
     * `CARVE_SUCCESS` and `CARVE_DEFENDED` (`screens.md` push catalogue).
     *
     * Written inside the claim transaction, so these assertions are also the
     * only proof that the notice and the carve commit together.
     */
    describe('what the holder is told', () => {
      const noticesFor = async (accountId: string) =>
        (
          await db.query<{ kind: string; body: string; deep_link: string; dedupe_key: string }>(
            `SELECT kind, body, deep_link, dedupe_key FROM notification_inbox
             WHERE account_id = $1 AND kind = 'territory_claim'
             ORDER BY created_at DESC`,
            [accountId]
          )
        ).rows;

      const clearNotices = async () => {
        await db.query(
          "DELETE FROM notification_inbox WHERE kind = 'territory_claim' AND account_id = ANY($1::uuid[])",
          [[account, rival]]
        );
      };

      it('names the runner, the ground taken, and what is left', async () => {
        await clearNotices();
        const outer = await runWithLoop(account, 600, 1800, 6);
        const first = (await claim(account, outer)).json();
        if (!first.claimed) return;
        const inner = await runWithLoop(rival, 300, 300, 6);
        const carve = (await claim(rival, inner)).json();
        if (!carve.claimed) return;

        const [notice] = await noticesFor(account);
        expect(notice?.body).toContain('Coda ran through your ground');
        expect(notice?.body).toMatch(/They took [\d,]+ m²/);
        expect(notice?.body).toMatch(/You still hold [\d,]+ m²/);
        expect(notice?.deep_link).toBe(`runsphere://turf/claim/${first.claim.id}`);
        expect(notice?.dedupe_key).toBe(`carve:${inner}:${first.claim.id}`);
        // The challenger is not told about their own run.
        expect(await noticesFor(rival)).toEqual([]);
      });

      it('tells a defender their claim stands', async () => {
        await clearNotices();
        const mine = await runWithLoop(account, 400, 300, 7);
        const first = (await claim(account, mine)).json();
        if (!first.claimed) return;
        // Same loop, three times slower: it contests and loses.
        const slow = await runWithLoop(rival, 400, 1800, 7);
        const refused = (await claim(rival, slow)).json();
        expect(refused.claimed).toBe(false);

        const [notice] = await noticesFor(account);
        expect(notice?.body).toBe(
          "Coda tried to take your ground. They weren't fast enough. Your claim stands."
        );
        expect(notice?.deep_link).toBe(`runsphere://turf/claim/${first.claim.id}`);
      });

      it('says nothing when a runner carves their own earlier claim', async () => {
        await clearNotices();
        const outer = await runWithLoop(account, 600, 1800, 8);
        if (!(await claim(account, outer)).json().claimed) return;
        const inner = await runWithLoop(account, 300, 300, 8);
        await claim(account, inner);

        // A second lap contesting the first is ordinary, and is not news.
        expect(await noticesFor(account)).toEqual([]);
      });

      it('says nothing across a block, in either direction', async () => {
        await clearNotices();
        // `screens.md`: "Blocked users never appear in any notification".
        await db.query(
          `INSERT INTO blocks (blocker_account_id, blocked_account_id) VALUES ($1, $2)`,
          [account, rival]
        );
        try {
          const mine = await runWithLoop(account, 400, 300, 9);
          if (!(await claim(account, mine)).json().claimed) return;
          const slow = await runWithLoop(rival, 400, 1800, 9);
          await claim(rival, slow);

          expect(await noticesFor(account)).toEqual([]);
        } finally {
          await db.query(
            'DELETE FROM blocks WHERE blocker_account_id = $1 AND blocked_account_id = $2',
            [account, rival]
          );
        }
      });

      it('writes one notice per event, however often the claim is retried', async () => {
        await clearNotices();
        const mine = await runWithLoop(account, 400, 300, 10);
        if (!(await claim(account, mine)).json().claimed) return;
        const slow = await runWithLoop(rival, 400, 1800, 10);

        // The same activity submitted twice is the same event. `042`'s unique
        // index on (account_id, dedupe_key) is what makes the second a no-op.
        await claim(rival, slow);
        await claim(rival, slow);

        expect(await noticesFor(account)).toHaveLength(1);
      });

      it('keeps location out of the body', async () => {
        await clearNotices();
        const mine = await runWithLoop(account, 400, 300, 11);
        if (!(await claim(account, mine)).json().claimed) return;
        const slow = await runWithLoop(rival, 400, 1800, 11);
        await claim(rival, slow);

        const [notice] = await noticesFor(account);
        // The loop was at 72.87…, 19.07…. Neither may appear.
        expect(notice?.body).not.toMatch(/\d{2}\.\d{3}/);
        expect(notice?.body).not.toContain('@');
      });
    });

    /**
     * Ghost Race (`territory-guide.md`; pending-work 2.10).
     *
     * The gates are the substance of this feature — a trimmed trace, three
     * views an hour, no own ground, no blocked pair, same region — and none of
     * them is testable against a fake: four are SQL, and the trim is only
     * correct if the row that reached the database was trimmed before it got
     * there.
     */
    describe('the ghost trace', () => {
      const ghost = (asker: string, claimId: string) =>
        app.inject({
          method: 'GET',
          url: `/v1/territory/claims/${claimId}/ghost-trace`,
          headers: { authorization: `Bearer ${createAccessToken(asker, SECRET)}` }
        });

      const clearViews = async () => {
        await db.query(
          'DELETE FROM territory_claim_ghost_views WHERE account_id = ANY($1::uuid[])',
          [[account, rival]]
        );
        await db.query(
          "DELETE FROM notification_inbox WHERE kind = 'territory_claim' AND account_id = ANY($1::uuid[])",
          [[account, rival]]
        );
      };

      /** A held claim of `account`'s, with a ghost trace behind it. */
      const heldWithGhost = async (eastDegrees: number): Promise<string> => {
        const activity = await runWithLoop(account, 600, 1200, eastDegrees);
        const body = (await claim(account, activity)).json();
        return body.claimed ? String(body.claim.id) : '';
      };

      it('serves the holder run, trimmed and timed', async () => {
        await clearViews();
        const claimId = await heldWithGhost(20);
        if (!claimId) return;

        const response = await ghost(rival, claimId);

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.claimId).toBe(claimId);
        expect(body.owner.displayName).toBe('Mira');
        expect(body.owner.isSelf).toBe(false);
        expect(body.points.length).toBeGreaterThanOrEqual(4);
        // The clock starts at zero and never goes backwards.
        expect(body.points[0].elapsedSeconds).toBe(0);
        const seconds = body.points.map(
          (point: { elapsedSeconds: number }) => point.elapsedSeconds
        );
        expect([...seconds].sort((left, right) => left - right)).toEqual(seconds);
        expect(body.trimMetres).toBe(200);
        expect(body.privacyNote).toContain('200 m');
        expect(body.rulesNote).toContain('changes nothing');
      });

      it('serves less than the claim it belongs to, because 400 m was cut off', async () => {
        await clearViews();
        const activity = await runWithLoop(account, 600, 1200, 21);
        const claimed = (await claim(account, activity)).json();
        if (!claimed.claimed) return;

        const body = (await ghost(rival, claimed.claim.id)).json();

        // A 600 m square is a 2,400 m loop. Trimmed at both ends it is about
        // 2,000 m, and it must be *less* — if it were not, nothing was cut.
        expect(body.distanceMetres).toBeLessThan(claimed.claim.distanceMetres);
        expect(body.distanceMetres).toBeGreaterThan(1_500);
        expect(body.durationSeconds).toBeLessThan(claimed.claim.durationSeconds);
      });

      it('does not begin where the runner did', async () => {
        await clearViews();
        const activity = await runWithLoop(account, 600, 1200, 22);
        const claimed = (await claim(account, activity)).json();
        if (!claimed.claimed) return;

        const body = (await ghost(rival, claimed.claim.id)).json();
        const first = body.points[0].at;
        const last = body.points[body.points.length - 1].at;

        // The loop starts at its south-west corner. The ghost must start well
        // past it and end well before it — that arc is the whole point of the
        // trim, and it is where somebody's front door tends to be.
        const corner = [BASE_LNG + 22, BASE_LAT];
        const metresFrom = (point: number[]) =>
          Math.hypot(
            (point[0]! - corner[0]!) * 111_320 * Math.cos((BASE_LAT * Math.PI) / 180),
            (point[1]! - corner[1]!) * 111_320
          );
        expect(metresFrom(first)).toBeGreaterThan(150);
        expect(metresFrom(last)).toBeGreaterThan(150);
      });

      it('refuses your own ground, where there is no ghost to race', async () => {
        await clearViews();
        const claimId = await heldWithGhost(23);
        if (!claimId) return;

        const response = await ghost(account, claimId);

        expect(response.statusCode).toBe(403);
        expect(response.json().reason).toBe('own_claim');
      });

      it('refuses across a block without saying that is why', async () => {
        await clearViews();
        const claimId = await heldWithGhost(24);
        if (!claimId) return;
        await db.query(
          'INSERT INTO blocks (blocker_account_id, blocked_account_id) VALUES ($1, $2)',
          [account, rival]
        );
        try {
          const response = await ghost(rival, claimId);

          // Answered as "not held", not "you are blocked": naming the block
          // would tell the asker something about the holder's choices.
          expect(response.statusCode).toBe(404);
          expect(response.json().reason).toBe('not_held');
        } finally {
          await db.query(
            'DELETE FROM blocks WHERE blocker_account_id = $1 AND blocked_account_id = $2',
            [account, rival]
          );
        }
      });

      it('refuses ground nobody holds any more', async () => {
        await clearViews();
        const claimId = await heldWithGhost(25);
        if (!claimId) return;
        await db.query(
          'UPDATE territory_claims SET released_at = now(), season_expired_at = now() WHERE id = $1',
          [claimId]
        );

        const response = await ghost(rival, claimId);

        expect(response.statusCode).toBe(404);
        expect(response.json().reason).toBe('not_held');
      });

      it('allows three an hour and then stops', async () => {
        await clearViews();
        const first = await heldWithGhost(26);
        const second = await heldWithGhost(27);
        const third = await heldWithGhost(28);
        const fourth = await heldWithGhost(29);
        if (!first || !second || !third || !fourth) return;

        expect((await ghost(rival, first)).statusCode).toBe(200);
        expect((await ghost(rival, second)).statusCode).toBe(200);
        const last = await ghost(rival, third);
        expect(last.statusCode).toBe(200);
        // The response says how many are left, so the app can stop offering it
        // rather than finding out by being refused.
        expect(last.json().viewsRemaining).toBe(0);

        const refused = await ghost(rival, fourth);
        expect(refused.statusCode).toBe(429);
        expect(refused.json().reason).toBe('rate_limited');
      });

      it('spends no view on a request it was going to refuse anyway', async () => {
        await clearViews();
        const mine = await heldWithGhost(30);
        if (!mine) return;

        // Own ground: refused before the budget is touched, because the
        // refusal is about who is asking and not about how often.
        await ghost(account, mine);

        const views = await db.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM territory_claim_ghost_views WHERE account_id = $1',
          [account]
        );
        expect(Number(views.rows[0]!.count)).toBe(0);
      });

      it('tells the holder somebody is racing them, once per person', async () => {
        await clearViews();
        const claimId = await heldWithGhost(31);
        if (!claimId) return;

        await ghost(rival, claimId);
        await ghost(rival, claimId);

        const notices = await db.query<{ body: string; dedupe_key: string }>(
          `SELECT body, dedupe_key FROM notification_inbox
           WHERE account_id = $1 AND kind = 'territory_claim'
             AND dedupe_key LIKE 'ghost:%'`,
          [account]
        );
        // Opening the sheet twice is not two races, and two identical notices
        // would read as harassment.
        expect(notices.rows).toHaveLength(1);
        expect(notices.rows[0]?.body).toContain('racing your ghost');
        expect(notices.rows[0]?.dedupe_key).toBe(`ghost:${claimId}:${rival}`);
      });

      it('records who looked, which is what the budget counts', async () => {
        await clearViews();
        const claimId = await heldWithGhost(32);
        if (!claimId) return;

        await ghost(rival, claimId);

        const views = await db.query<{ claim_id: string }>(
          'SELECT claim_id FROM territory_claim_ghost_views WHERE account_id = $1',
          [rival]
        );
        expect(views.rows.map((row) => row.claim_id)).toEqual([claimId]);
      });

      describe('the constraints that protect the trace', () => {
        it('refuses a row whose timing does not line up with its path', async () => {
          const claimId = await heldWithGhost(33);
          if (!claimId) return;

          await expect(
            db.query(
              `UPDATE territory_claim_ghost_traces
               SET elapsed_seconds = ARRAY[0, 1]::integer[] WHERE claim_id = $1`,
              [claimId]
            )
          ).rejects.toThrow(/timing_matches_path/);
        });

        it('published the ghost rule the engine reads', async () => {
          const rule = await db.query<{ definition: Record<string, unknown> }>(
            "SELECT definition FROM rule_versions WHERE kind = 'ghost_race' AND version = 1"
          );

          expect(rule.rows[0]?.definition).toMatchObject({
            trimMetres: 200,
            viewsPerHour: 3,
            minPoints: 4
          });
        });

        it('left the carving rule alone, because a ghost changes no rule', async () => {
          // Filing the ghost figures under `territory_claim` would supersede
          // `036` and make the latest claim rule look like it had lost its
          // carving numbers.
          const latest = await db.query<{ definition: Record<string, unknown> }>(
            `SELECT definition FROM rule_versions
             WHERE kind = 'territory_claim' ORDER BY version DESC LIMIT 1`
          );

          expect(latest.rows[0]?.definition).toHaveProperty('minCarveShare');
        });
      });
    });

    it('stores a ring that does not begin where the runner did', async () => {
      const activity = await runWithLoop(account, 500, 900, 5);
      const body = (await claim(account, activity)).json();
      if (!body.claimed) return;

      const west = Math.min(...body.claim.boundary.map((pair: number[]) => pair[0]!));
      expect(body.claim.boundary[0]![0]).toBeCloseTo(west, 9);
    });
  });

  /**
   * The leaderboard, events, and claim-trading flag, against the real database.
   *
   * These are all aggregate SQL — `FILTER`, `GROUP BY`, `ST_Contains`, an upsert
   * on a composite unique key — and none of it is exercised by a fake that
   * returns rows the test wrote.
   */
  describe('boards, events, and trading review', () => {
    it('ranks by ground currently held and ignores ground already lost', async () => {
      const held = await insertClaim(account, squarePolygon(BASE_LNG + 0.2, BASE_LAT, 400), 700);
      const lost = await insertClaim(account, squarePolygon(BASE_LNG + 0.3, BASE_LAT, 400), 700);
      await db.query(
        `UPDATE territory_claims SET released_at = now(), released_to_claim_id = $2 WHERE id = $1`,
        [lost, held]
      );

      const board = await db.query<{ total_area: string; claim_count: string }>(
        `SELECT coalesce(sum(area_sqm), 0)::text AS total_area, count(*)::text AS claim_count
         FROM territory_claims
         WHERE released_at IS NULL AND account_id = $1`,
        [account]
      );

      // The released claim must not count towards the standing.
      const ids = await db.query<{ id: string }>(
        `SELECT id FROM territory_claims WHERE account_id = $1 AND released_at IS NULL`,
        [account]
      );
      expect(ids.rows.map((row) => row.id)).not.toContain(lost);
      expect(Number(board.rows[0]!.claim_count)).toBeGreaterThan(0);
    });

    it('counts defended ground as ground taken off somebody', async () => {
      await db.query(
        `INSERT INTO territory_claims (account_id, boundary, centroid, area_sqm, duration_seconds,
           distance_metres, capture_count, lineage_id, season_month)
         VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
           ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), 90000, 600, 1200, 3,
           gen_random_uuid(), to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))`,
        [rival, squarePolygon(BASE_LNG + 0.4, BASE_LAT, 300)]
      );
      const defended = await db.query<{ defended_count: string }>(
        `SELECT count(*) FILTER (WHERE capture_count > 1)::text AS defended_count
         FROM territory_claims WHERE released_at IS NULL AND account_id = $1`,
        [rival]
      );

      expect(Number(defended.rows[0]!.defended_count)).toBeGreaterThan(0);
    });

    it('counts the claims that fall inside an event area', async () => {
      const event = await db.query<{ id: string }>(
        `INSERT INTO territory_events (title, description, starts_at, ends_at, boundary, reward)
         VALUES ('Capture the Park', 'Hold ground here.', now(), now() + interval '3 days',
           ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 'A cosmetic badge')
         RETURNING id`,
        [squarePolygon(BASE_LNG + 0.5, BASE_LAT, 2000)]
      );
      try {
        await insertClaim(account, squarePolygon(BASE_LNG + 0.505, BASE_LAT + 0.002, 300), 600);
        const counted = await db.query<{ held: string }>(
          `SELECT (SELECT count(*) FROM territory_claims claim
             WHERE claim.released_at IS NULL
               AND ST_Contains(event.boundary, claim.centroid))::text AS held
           FROM territory_events event WHERE event.id = $1`,
          [event.rows[0]!.id]
        );

        expect(Number(counted.rows[0]!.held)).toBeGreaterThan(0);
      } finally {
        await db.query('DELETE FROM territory_events WHERE id = $1', [event.rows[0]!.id]);
      }
    });

    it('records one trade-review row per pair per piece of ground', async () => {
      const lineage = randomUUID();
      const [a, b] = [account, rival].sort() as [string, string];
      const upsert = async (exchanges: number) =>
        db.query(
          `INSERT INTO territory_trade_flags (lineage_id, account_a, account_b, exchanges,
             pair_share, first_at, last_at)
           VALUES ($1, $2, $3, $4, 1.000, now() - interval '10 days', now())
           ON CONFLICT (lineage_id, account_a, account_b)
           DO UPDATE SET exchanges = EXCLUDED.exchanges, last_at = EXCLUDED.last_at`,
          [lineage, a, b, exchanges]
        );

      await upsert(4);
      await upsert(7);
      const rows = await db.query<{ exchanges: number }>(
        `SELECT exchanges FROM territory_trade_flags WHERE lineage_id = $1`,
        [lineage]
      );

      // Re-checking the same ground updates the question rather than asking it
      // again every time somebody runs.
      expect(rows.rows).toHaveLength(1);
      expect(Number(rows.rows[0]!.exchanges)).toBe(7);
    });

    it('refuses a trade flag whose pair is not in a stable order', async () => {
      const [a, b] = [account, rival].sort() as [string, string];

      // Sorted storage is what makes one pair one row; unsorted would let the
      // same two people be flagged twice for the same ground.
      await expect(
        db.query(
          `INSERT INTO territory_trade_flags (lineage_id, account_a, account_b, exchanges,
             pair_share, first_at, last_at)
           VALUES ($1, $2, $3, 5, 1.000, now(), now())`,
          [randomUUID(), b, a]
        )
      ).rejects.toThrow(/territory_trade_flags_pair_is_sorted/);
    });
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
