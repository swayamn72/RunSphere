import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled
} from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * M9 9.1-9.3 against real PostgreSQL: a run is created in one of four modes,
 * and the server refuses a mode it can't honour. Synthetic positions only.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'run-modes-integration-secret' });

const created: { quests: string[] } = { quests: [] };

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled)
    await db.query('DELETE FROM quest_versions WHERE id = ANY($1::uuid[])', [created.quests]);
  await app.close();
  await db.end();
});

let nextClient = 0;
const runner = async (): Promise<{ token: string; id: string }> => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `192.0.2.${(nextClient += 1) % 250}`,
    payload: {
      email: `modes-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-05-05',
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  return { token, id };
};

const start = (token: string, payload: Record<string, unknown>, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/v1/activities',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    payload: { movementType: 'run', ...payload }
  });

const publishedQuest = async (): Promise<string> => {
  const quest = await db.query<{ id: string }>(
    `INSERT INTO quest_versions (quest_key, version, title, distance_meters,
       estimated_active_minutes, accessibility, open_hours, provenance, source_reviewed_at,
       published_at)
     VALUES ($1, 1, 'Mode test quest', 600, 6, 'step-free', '{}'::jsonb, '{}'::jsonb, now(), now())
     RETURNING id`,
    [`modes-test-${randomUUID()}`]
  );
  created.quests.push(quest.rows[0]!.id);
  return quest.rows[0]!.id;
};

/** A held claim with a ghost trace, on synthetic ground far from anywhere real. */
const claimWithGhost = async (accountId: string, lng: number): Promise<string> => {
  const d = 0.002;
  const ring = [
    [lng, 0],
    [lng + d, 0],
    [lng + d, d],
    [lng, d],
    [lng, 0]
  ];
  const claim = await db.query<{ id: string }>(
    `INSERT INTO territory_claims (account_id, boundary, centroid, area_sqm, distance_metres,
       duration_seconds, capture_count, lineage_id, season_month)
     VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
       ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)),
       ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography), 900, 300, 1,
       gen_random_uuid(), to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))
     RETURNING id`,
    [accountId, JSON.stringify({ type: 'Polygon', coordinates: [ring] })]
  );
  const id = claim.rows[0]!.id;
  await db.query(
    `INSERT INTO territory_claim_ghost_traces (claim_id, path, elapsed_seconds, distance_metres,
       duration_seconds, trim_metres)
     VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), ARRAY[0, 60, 120, 180], 500, 180, 200)`,
    [id, JSON.stringify({ type: 'LineString', coordinates: ring.slice(0, 4) })]
  );
  return id;
};

describePostgis('run modes are stored and checked when a run starts (M9)', () => {
  it('stores a free run and shows its mode back', async () => {
    const me = await runner();
    const response = await start(me.token, { runMode: 'free' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ runMode: 'free' });

    const id = (response.json() as { id: string }).id;
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/activities/${id}`,
      headers: { authorization: `Bearer ${me.token}` }
    });
    expect(detail.json()).toMatchObject({ runMode: 'free' });
  });

  it('keeps accepting runs from builds that predate modes, with no mode', async () => {
    const me = await runner();
    const response = await start(me.token, {});
    expect(response.statusCode).toBe(201);
    expect(response.json()).not.toHaveProperty('runMode');
  });

  it('refuses a target on the wrong mode', async () => {
    const me = await runner();
    const quest = await start(me.token, { runMode: 'turf', questId: randomUUID() });
    expect(quest.statusCode).toBe(400);
    const ghost = await start(me.token, { runMode: 'free', ghostClaimId: randomUUID() });
    expect(ghost.statusCode).toBe(400);
  });

  it('starts a quest run only for a quest the runner has taken on', async () => {
    const me = await runner();
    const questId = await publishedQuest();

    expect((await start(me.token, { runMode: 'quest' })).statusCode).toBe(400);
    const early = await start(me.token, { runMode: 'quest', questId });
    expect(early.statusCode).toBe(400);
    expect((early.json() as { message: string }).message).toMatch(/Take this quest on first/);

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/quests/${questId}/accept`,
      headers: { authorization: `Bearer ${me.token}` }
    });
    expect(accepted.statusCode).toBeLessThan(300);
    const run = await start(me.token, { runMode: 'quest', questId });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ runMode: 'quest', questId });
  });

  it('starts a Ghost Race only on a rival claim the ghost-trace rules allow', async () => {
    const me = await runner();
    const rival = await runner();
    const theirs = await claimWithGhost(rival.id, 100 + Math.random());
    const mine = await claimWithGhost(me.id, 110 + Math.random());

    expect((await start(me.token, { runMode: 'ghost' })).statusCode).toBe(400);
    expect((await start(me.token, { runMode: 'ghost', ghostClaimId: mine })).statusCode).toBe(403);
    expect(
      (await start(me.token, { runMode: 'ghost', ghostClaimId: randomUUID() })).statusCode
    ).toBe(404);

    // Holding ground elsewhere this season puts `theirs` out of region only if
    // it has a city tag; these synthetic claims have none, so it's allowed.
    const race = await start(me.token, { runMode: 'ghost', ghostClaimId: theirs });
    expect(race.statusCode).toBe(201);
    expect(race.json()).toMatchObject({ runMode: 'ghost', ghostClaimId: theirs });
  });

  it('replays the same key and body without re-checking the mode', async () => {
    const me = await runner();
    const questId = await publishedQuest();
    await app.inject({
      method: 'POST',
      url: `/v1/quests/${questId}/accept`,
      headers: { authorization: `Bearer ${me.token}` }
    });
    const key = randomUUID();
    const first = await start(me.token, { runMode: 'quest', questId }, key);
    expect(first.statusCode).toBe(201);
    // Abandoning the quest would now refuse a new quest run, but not a retry.
    const abandoned = await app.inject({
      method: 'DELETE',
      url: `/v1/quests/${questId}/accept`,
      headers: { authorization: `Bearer ${me.token}` }
    });
    expect(abandoned.statusCode).toBeLessThan(300);
    expect((await start(me.token, { runMode: 'quest', questId })).statusCode).toBe(400);
    const retry = await start(me.token, { runMode: 'quest', questId }, key);
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
  });
});
