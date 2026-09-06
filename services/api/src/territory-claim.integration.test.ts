import { randomUUID } from 'node:crypto';
import { createDatabase, defaultDatabaseUrl, migrate } from '@runsphere/db';
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
const enabled = Boolean(
  process.env.RUN_POSTGIS_INTEGRATION && (process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD)
);
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

const makeAccount = async (): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`turf-${randomUUID()}@example.test`]
  );
  return created.rows[0]!.id;
};

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  account = await makeAccount();
  rival = await makeAccount();
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await app.close();
  // Accounts cascade to claims, zones, and takeovers.
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
       duration_seconds, capture_count, lineage_id)
     VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
       ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
       ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography), 1200, $3, 1,
       gen_random_uuid())
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
    it('refuses a takeover that was not actually faster', async () => {
      const held = await insertClaim(rival, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);
      const taking = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 900);

      // A slower time must never be able to record a takeover, whatever the
      // application layer believes.
      await expect(
        db.query(
          `INSERT INTO territory_claim_takeovers (taken_claim_id, taken_from_account_id,
             taken_by_claim_id, taken_by_account_id, previous_duration_seconds,
             new_duration_seconds)
           VALUES ($1, $2, $3, $4, 600, 900)`,
          [held, rival, taking, account]
        )
      ).rejects.toThrow(/territory_claim_takeovers_is_faster/);
    });

    it('refuses a half-released claim', async () => {
      const id = await insertClaim(account, squarePolygon(BASE_LNG, BASE_LAT, 300), 600);

      // Released without a successor would leave ground nobody holds and no
      // way to say who took it.
      await expect(
        db.query('UPDATE territory_claims SET released_at = now() WHERE id = $1', [id])
      ).rejects.toThrow(/territory_claims_release_is_complete/);
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
      `SELECT definition FROM rule_versions WHERE kind = 'territory_claim' AND version = 1`
    );

    expect(rule.rows[0]?.definition).toMatchObject({
      closeWithinMetres: 60,
      minAreaSqm: 5000,
      takeoverOverlapRatio: 0.6
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
      totalSeconds: number
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
      const corners = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + dLng, BASE_LAT],
        [BASE_LNG + dLng, BASE_LAT + dLat],
        [BASE_LNG, BASE_LAT + dLat]
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
      const activity = await runWithLoop(account, 400, 900);
      const response = await claim(account, activity);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.claimed).toBe(true);
      expect(body.claim.areaSqm).toBeGreaterThan(100_000);
      expect(body.claim.durationSeconds).toBeGreaterThan(0);
    });

    it('hands the ground to a faster rival and records both times', async () => {
      const mine = await runWithLoop(account, 400, 1200);
      await claim(account, mine);
      const theirs = await runWithLoop(rival, 400, 600);
      const response = await claim(rival, theirs);

      const body = response.json();
      expect(body.claimed).toBe(true);
      expect(body.takenOverCount).toBeGreaterThan(0);

      const ledger = await db.query<{ previous_duration_seconds: number }>(
        `SELECT previous_duration_seconds FROM territory_claim_takeovers
         WHERE taken_by_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [rival]
      );
      expect(Number(ledger.rows[0]!.previous_duration_seconds)).toBeGreaterThan(600);
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
        const activity = await runWithLoop(account, 400, 900);
        const body = (await claim(account, activity)).json();

        // The whole point of 5.4, proven against the database rather than a stub.
        expect(body).toMatchObject({ claimed: false, refusal: 'privacy_zone' });
      } finally {
        await db.query('DELETE FROM privacy_zones WHERE id = $1', [zone.rows[0]!.id]);
      }
    });

    it('stores a ring that does not begin where the runner did', async () => {
      const activity = await runWithLoop(account, 500, 900);
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
           capture_count, lineage_id)
         VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
           ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), 90000, 600, 3,
           gen_random_uuid())`,
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
