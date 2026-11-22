import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi,
  withTransaction
} from '@runsphere/db';
import type { ProfileRunsResponse, RunLogResponse } from '@runsphere/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * M9 9.13 against real PostgreSQL: your own run log, 20 a page, newest first,
 * counted runs only, with each mode's result and a route of at most 100 points.
 * Accounts and quests are removed afterwards so later suites don't see them (B19).
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'run-log-integration-secret' });
const created: { accounts: string[]; quests: string[] } = { accounts: [], quests: [] };

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled) {
    // Registration writes consent history, which only an erasure may delete.
    await withTransaction(db, async (client) => {
      await client.query("SELECT set_config('runsphere.account_erasure', 'on', true)");
      await client.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [created.accounts]);
    });
    await db.query('DELETE FROM quest_versions WHERE id = ANY($1::uuid[])', [created.quests]);
  }
  await app.close();
  await db.end();
});

let nextClient = 0;
const runner = async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.18.0.${(nextClient += 1)}`,
    payload: {
      email: `runlog-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-05-05',
      username: `log_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  created.accounts.push(id);
  const username = (
    await db.query<{ username: string }>('SELECT username FROM accounts WHERE id = $1', [id])
  ).rows[0]!.username;
  return { token, id, username };
};

/** Synthetic ground near 0°, 0°, nowhere real. */
const ring = (lng: number) => [
  [lng, 0],
  [lng + 0.002, 0],
  [lng + 0.002, 0.002],
  [lng, 0.002],
  [lng, 0]
];

const claim = async (accountId: string, activityId: string | null, lng: number) =>
  (
    await db.query<{ id: string }>(
      `INSERT INTO territory_claims (account_id, activity_id, boundary, centroid, area_sqm,
         distance_metres, duration_seconds, capture_count, lineage_id, season_month)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
         ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), 49000, 900, 300, 1,
         gen_random_uuid(), to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))
       RETURNING id`,
      [accountId, activityId, JSON.stringify({ type: 'Polygon', coordinates: [ring(lng)] })]
    )
  ).rows[0]!.id;

interface RunFixture {
  createdAt: Date;
  status?: string;
  mode?: string | null;
  questVersionId?: string;
  ghostClaimId?: string;
  route?: number[][][] | null;
  metrics?: boolean;
}

const run = async (accountId: string, fixture: RunFixture) => {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type,
       request_fingerprint, status, processed_at, finalized_at, created_at, run_mode,
       quest_version_id, ghost_claim_id, summary)
     VALUES ($1, $2, 'run', 'fixture', $3, $4, $4, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
    [
      accountId,
      randomUUID(),
      fixture.status ?? 'derived',
      fixture.createdAt,
      fixture.mode ?? null,
      fixture.questVersionId ?? null,
      fixture.ghostClaimId ?? null,
      JSON.stringify({ distanceMeters: 2_000, durationSeconds: 600 })
    ]
  );
  const id = inserted.rows[0]!.id;
  if ((fixture.status ?? 'derived') === 'derived') {
    const route =
      fixture.route === null
        ? null
        : JSON.stringify({ type: 'MultiLineString', coordinates: fixture.route ?? [ring(0)] });
    await db.query(
      `INSERT INTO activity_derivations (activity_id, shareable_route, source_checksum,
         route_checksum, policy_version, algorithm_version, applied_zone_ids, applied_zones,
         removed_point_count, outcome)
       VALUES ($1, CASE WHEN $2::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) END,
         'fixture', 'fixture', 'm2-privacy-200m', 'm2-canonical-v1', '{}', '[]'::jsonb, 0,
         CASE WHEN $2::text IS NULL THEN 'no-shareable-route' ELSE 'trimmed' END)`,
      [id, route]
    );
  }
  if (fixture.metrics)
    await db.query(
      `INSERT INTO activity_metrics (activity_id, metrics_version, metrics, moving_seconds,
         elevation_gain_meters)
       VALUES ($1, 1, '{"movingPaceSecondsPerKm": 290}'::jsonb, 580, 12)`,
      [id]
    );
  return id;
};

const log = async (token: string, cursor?: string) =>
  app.inject({
    method: 'GET',
    url: `/v1/runs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    headers: { authorization: `Bearer ${token}` }
  });

describePostgis('run log (M9 9.13)', () => {
  it('pages your counted runs, newest first, and leaves out the rest', async () => {
    const me = await runner();
    const other = await runner();
    const base = Date.UTC(2026, 10, 1, 0, 30);
    const ids: string[] = [];
    for (let day = 0; day < 23; day += 1)
      ids.push(await run(me.id, { createdAt: new Date(base + day * 86_400_000) }));
    await run(me.id, { createdAt: new Date(base + 30 * 86_400_000), status: 'validating' });
    await run(me.id, { createdAt: new Date(base + 31 * 86_400_000), status: 'rejected' });
    const deleted = await run(me.id, { createdAt: new Date(base + 32 * 86_400_000) });
    await db.query('UPDATE activity_submissions SET deleted_at = now() WHERE id = $1', [deleted]);
    await run(other.id, { createdAt: new Date(base + 40 * 86_400_000) });

    const first = await log(me.token);
    expect(first.statusCode).toBe(200);
    const page1 = first.json() as RunLogResponse;
    expect(page1.data.map((item) => item.id)).toEqual(ids.slice(3).reverse());
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = (await log(me.token, page1.nextCursor!)).json() as RunLogResponse;
    expect(page2.data.map((item) => item.id)).toEqual(ids.slice(0, 3).reverse());
    expect(page2.nextCursor).toBeNull();

    // 06:00 IST on 1 November is 00:30 UTC: the date is India's.
    expect(page2.data.at(-1)).toMatchObject({
      startedOn: '2026-11-01',
      startedAt: '2026-11-01T00:30:00.000Z',
      distanceMeters: 2_000,
      durationSeconds: 600,
      paceSecondsPerKm: 300,
      movingSeconds: null,
      elevationGainMeters: null,
      result: {}
    });
  });

  it('refuses a cursor it did not write', async () => {
    const me = await runner();
    expect((await log(me.token, 'not-a-cursor')).statusCode).toBe(400);
  });

  it('shows each mode’s result and the metrics when they exist', async () => {
    const me = await runner();
    const rival = await runner();
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 5, 1, minutes));

    const turf = await run(me.id, { createdAt: at(0), mode: 'turf', metrics: true });
    await claim(me.id, turf, 0.01);

    const quest = await db.query<{ id: string }>(
      `INSERT INTO quest_versions (quest_key, version, title, distance_meters,
         estimated_active_minutes, accessibility, open_hours, provenance, source_reviewed_at,
         published_at)
       VALUES ($1, 1, 'Seaface stretch', 600, 6, 'step-free', '{}'::jsonb, '{}'::jsonb, now(), now())
       RETURNING id`,
      [`runlog-${randomUUID()}`]
    );
    created.quests.push(quest.rows[0]!.id);
    const questRun = await run(me.id, {
      createdAt: at(1),
      mode: 'quest',
      questVersionId: quest.rows[0]!.id
    });
    await db.query(
      `INSERT INTO quest_completions (account_id, quest_version_id, activity_submission_id)
       VALUES ($1, $2, $3)`,
      [me.id, quest.rows[0]!.id, questRun]
    );

    const raced = await claim(rival.id, null, 0.02);
    const won = await run(me.id, { createdAt: at(2), mode: 'ghost', ghostClaimId: raced });
    const mine = await claim(me.id, won, 0.02);
    await db.query(
      'UPDATE territory_claims SET released_at = now(), released_to_claim_id = $2 WHERE id = $1',
      [raced, mine]
    );
    const otherRaced = await claim(rival.id, null, 0.03);
    await run(me.id, { createdAt: at(3), mode: 'ghost', ghostClaimId: otherRaced });
    await run(me.id, { createdAt: at(4), mode: 'free', route: null });

    const { data } = (await log(me.token)).json() as RunLogResponse;
    expect(data.map((item) => [item.runMode, item.result])).toEqual([
      ['free', {}],
      ['ghost', { ghostWon: false }],
      ['ghost', { ghostWon: true, claimedAreaSqm: 49_000 }],
      ['quest', { questCompleted: true, questTitle: 'Seaface stretch' }],
      ['turf', { claimedAreaSqm: 49_000 }]
    ]);
    expect(data[0]!.route).toBeNull();
    expect(data[4]).toMatchObject({
      movingSeconds: 580,
      paceSecondsPerKm: 290,
      elevationGainMeters: 12
    });
  });

  it('draws the route with at most 100 points', async () => {
    const me = await runner();
    const long = Array.from({ length: 2_000 }, (_, index) => [
      Math.sin(index / 10) * 0.001,
      index * 0.00002
    ]);
    await run(me.id, { createdAt: new Date(), route: [long] });
    const { data } = (await log(me.token)).json() as RunLogResponse;
    const points = data[0]!.route!.flat();
    expect(points.length).toBeLessThanOrEqual(100);
    expect(points.length).toBeGreaterThan(10);
  });
});

describePostgis('someone else’s runs follow their settings (M9 9.14, ADR-0015)', () => {
  const profileRuns = async (reader: { token: string }, username: string) =>
    app.inject({
      method: 'GET',
      url: `/v1/profiles/by-username/${username}/runs`,
      headers: { authorization: `Bearer ${reader.token}` }
    });
  const befriend = async (a: string, b: string) =>
    db.query(
      `INSERT INTO friendships (account_id, friend_account_id) VALUES ($1, $2), ($2, $1)
       ON CONFLICT DO NOTHING`,
      [a, b]
    );
  const settle = (accountId: string, settings: Record<string, unknown>) =>
    db.query(
      `UPDATE privacy_settings SET
         runs_visibility = COALESCE($2, runs_visibility),
         show_route_maps = COALESCE($3, show_route_maps),
         show_start_times = COALESCE($4, show_start_times),
         trim_start_finish = COALESCE($5, trim_start_finish),
         profile_visibility = COALESCE($6, profile_visibility)
       WHERE account_id = $1`,
      [
        accountId,
        settings['runs'] ?? null,
        settings['routes'] ?? null,
        settings['times'] ?? null,
        settings['trim'] ?? null,
        settings['profile'] ?? null
      ]
    );
  /** One run on a straight 1 km line, synthetic. */
  const straight = Array.from({ length: 101 }, (_, index) => [0.05, index * 0.00009]);

  const setup = async () => {
    const owner = await runner();
    const friend = await runner();
    const stranger = await runner();
    await befriend(owner.id, friend.id);
    await run(owner.id, { createdAt: new Date(Date.UTC(2026, 10, 10, 1)), route: [straight] });
    return { owner, friend, stranger };
  };
  const page = async (reader: { token: string }, username: string) =>
    (await profileRuns(reader, username)).json() as ProfileRunsResponse;

  it('by default shows friends the run, whole route and date only, and strangers nothing', async () => {
    const { owner, friend, stranger } = await setup();
    const seen = await page(friend, owner.username);
    expect(seen.visible).toBe(true);
    expect(seen.data).toHaveLength(1);
    expect(seen.data[0]!.startedOn).toBe('2026-11-10');
    expect(seen.data[0]).not.toHaveProperty('startedAt');
    // Not trimmed by default: the route still reaches its very start.
    expect(seen.data[0]!.route![0]![0]).toEqual([0.05, 0]);

    const hidden = await profileRuns(stranger, owner.username);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toEqual({ visible: false, data: [], nextCursor: null });
  });

  it('applies every setting: everyone, only me, route maps, start times and the trim', async () => {
    const { owner, friend, stranger } = await setup();

    await settle(owner.id, { runs: 'everyone' });
    expect((await page(stranger, owner.username)).data).toHaveLength(1);

    await settle(owner.id, { runs: 'only_me' });
    expect((await page(friend, owner.username)).visible).toBe(false);
    expect((await page(owner, owner.username)).data[0]).toHaveProperty('startedAt');

    await settle(owner.id, { runs: 'friends', routes: false });
    expect((await page(friend, owner.username)).data[0]!.route).toBeNull();

    await settle(owner.id, { routes: true, times: true, trim: true });
    const trimmed = (await page(friend, owner.username)).data[0]!;
    expect(trimmed.startedAt).toBe('2026-11-10T01:00:00.000Z');
    // About 200 m gone from each end: 0.0018 degrees of latitude.
    expect(trimmed.route![0]![0]![1]).toBeGreaterThan(0.0017);
    expect(trimmed.route!.flat().at(-1)![1]).toBeLessThan(0.009 - 0.0017);
    // The owner always sees their own route whole.
    expect((await page(owner, owner.username)).data[0]!.route![0]![0]).toEqual([0.05, 0]);
  });

  it('hides runner and runs alike behind a block, or a private profile', async () => {
    const { owner, friend, stranger } = await setup();
    await db.query(
      `INSERT INTO blocks (blocker_account_id, blocked_account_id, reason) VALUES ($1, $2, 'test')`,
      [owner.id, friend.id]
    );
    expect((await profileRuns(friend, owner.username)).statusCode).toBe(404);
    await settle(owner.id, { runs: 'everyone', profile: 'only_me' });
    expect((await profileRuns(stranger, owner.username)).statusCode).toBe(404);
    expect((await profileRuns(stranger, 'no_such_runner_here')).statusCode).toBe(404);
  });
});

describe('run log integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
