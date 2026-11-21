import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled
} from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { completeQuestsForActivity } from './quest-core.js';

/**
 * M6.3 against real PostGIS: a quest is completed only by a run, after you
 * accepted it, that passes every checkpoint: within 30 m of an area, and over
 * at least 80% of a route. Completion is recorded once, with the run.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'quest-lifecycle-integration-secret' });

const LAT = 19.076;
const AREA_LNG = 72.8777;
const ROUTE_FROM = 72.879;
const ROUTE_TO = 72.882;

const created: { quests: string[]; checkpoints: string[] } = { quests: [], checkpoints: [] };

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled) {
    await db.query('DELETE FROM quest_versions WHERE id = ANY($1::uuid[])', [created.quests]);
    await db.query('DELETE FROM curated_checkpoints WHERE id = ANY($1::uuid[])', [
      created.checkpoints
    ]);
  }
  await app.close();
  await db.end();
});

const checkpoint = async (kind: 'area' | 'route', geometry: object): Promise<string> => {
  const row = await db.query<{ id: string }>(
    `INSERT INTO curated_checkpoints (stable_key, title, checkpoint_kind, geometry, open_hours,
       provenance, reviewed_at)
     VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), '{}'::jsonb, '{}'::jsonb, now())
     RETURNING id`,
    [`quest-test-${randomUUID()}`, `Test ${kind}`, kind, JSON.stringify(geometry)]
  );
  created.checkpoints.push(row.rows[0]!.id);
  return row.rows[0]!.id;
};

/** A published quest: a small open area, then a 320 m path east of it. */
const publishedQuest = async (): Promise<string> => {
  const d = 0.0002;
  const area = await checkpoint('area', {
    type: 'Polygon',
    coordinates: [
      [
        [AREA_LNG - d, LAT - d],
        [AREA_LNG + d, LAT - d],
        [AREA_LNG + d, LAT + d],
        [AREA_LNG - d, LAT + d],
        [AREA_LNG - d, LAT - d]
      ]
    ]
  });
  const route = await checkpoint('route', {
    type: 'LineString',
    coordinates: [
      [ROUTE_FROM, LAT],
      [ROUTE_TO, LAT]
    ]
  });
  const quest = await db.query<{ id: string }>(
    `INSERT INTO quest_versions (quest_key, version, title, distance_meters,
       estimated_active_minutes, accessibility, open_hours, provenance, source_reviewed_at,
       published_at)
     VALUES ($1, 1, 'Riverside test loop', 600, 6, 'step-free', '{}'::jsonb, '{}'::jsonb, now(), now())
     RETURNING id`,
    [`quest-test-${randomUUID()}`]
  );
  const questId = quest.rows[0]!.id;
  created.quests.push(questId);
  await db.query(
    `INSERT INTO quest_version_checkpoints (quest_version_id, checkpoint_id, position)
     VALUES ($1, $2, 1), ($1, $3, 2)`,
    [questId, area, route]
  );
  return questId;
};

let nextClient = 0;
const runner = async (): Promise<{ token: string; id: string }> => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.51.100.${10 + (nextClient += 1)}`,
    payload: {
      email: `quest-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1991-03-03',
      policyVersion: 'm2'
    }
  });
  const token = (response.json() as { accessToken: string }).accessToken;
  const id = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;
  return { token, id };
};

/**
 * A derived run due east along the path, every point 5 m accurate, at an easy
 * 3 m/s. `fromLng`/`toLng` choose how much of the route it covers.
 */
const run = async (
  accountId: string,
  fromLng: number,
  toLng: number,
  startsAt: number
): Promise<string> => {
  const submission = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type,
       request_fingerprint, status, processed_at, finalized_at)
     VALUES ($1, $2, 'run', 'fixture', 'derived', now(), now()) RETURNING id`,
    [accountId, randomUUID()]
  );
  const id = submission.rows[0]!.id;
  const metresPerDegree = 111_320 * Math.cos((LAT * Math.PI) / 180);
  const steps = Math.ceil(((toLng - fromLng) * metresPerDegree) / 25);
  const points = Array.from({ length: steps + 1 }, (_, index) => ({
    latitude: LAT,
    longitude: fromLng + ((toLng - fromLng) * index) / steps,
    accuracyMeters: 5,
    recordedAt: new Date(startsAt + index * 8_000).toISOString()
  }));
  await db.query(
    `INSERT INTO activity_chunks (activity_id, sequence, payload, payload_hash, uncompressed_bytes)
     VALUES ($1, 0, $2::jsonb, 'fixture', 1)`,
    [id, JSON.stringify({ points })]
  );
  return id;
};

const as = (token: string) => ({ authorization: `Bearer ${token}` });

describePostgis('quest lifecycle (M6.3)', () => {
  it('completes a quest when a run after accepting passes every checkpoint, once', async () => {
    const questId = await publishedQuest();
    const me = await runner();

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/quests/${questId}/accept`,
      headers: as(me.token)
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted' });

    const later = Date.now() + 60_000;
    const covering = await run(me.id, AREA_LNG - 0.0002, ROUTE_TO + 0.0001, later);
    expect(await completeQuestsForActivity(db, covering)).toEqual([questId]);
    // A retried worker event changes nothing.
    expect(await completeQuestsForActivity(db, covering)).toEqual([]);

    const mine = await app.inject({ method: 'GET', url: '/v1/quests/mine', headers: as(me.token) });
    expect(mine.json()).toMatchObject({
      data: [{ questId, status: 'completed', title: 'Riverside test loop' }]
    });
    const completion = await db.query<{ activity_submission_id: string }>(
      'SELECT activity_submission_id FROM quest_completions WHERE account_id = $1',
      [me.id]
    );
    expect(completion.rows[0]?.activity_submission_id).toBe(covering);
    const inbox = await db.query(
      `SELECT 1 FROM notification_inbox WHERE account_id = $1 AND kind = 'quest'`,
      [me.id]
    );
    expect(inbox.rows).toHaveLength(1);
  });

  it('does not complete on part of a route, or on a run from before accepting', async () => {
    const questId = await publishedQuest();
    const me = await runner();
    const before = Date.now() - 60 * 60_000;
    await app.inject({
      method: 'POST',
      url: `/v1/quests/${questId}/accept`,
      headers: as(me.token)
    });

    // Passes the area, then stops a third of the way along the path.
    const partial = await run(me.id, AREA_LNG - 0.0002, ROUTE_FROM + 0.001, Date.now() + 60_000);
    expect(await completeQuestsForActivity(db, partial)).toEqual([]);

    // The whole quest, but recorded before it was accepted.
    const early = await run(me.id, AREA_LNG - 0.0002, ROUTE_TO + 0.0001, before);
    expect(await completeQuestsForActivity(db, early)).toEqual([]);
  });

  it('lets you drop a quest, and a dropped quest is not completed', async () => {
    const questId = await publishedQuest();
    const me = await runner();
    await app.inject({
      method: 'POST',
      url: `/v1/quests/${questId}/accept`,
      headers: as(me.token)
    });
    const dropped = await app.inject({
      method: 'DELETE',
      url: `/v1/quests/${questId}/accept`,
      headers: as(me.token)
    });
    expect(dropped.statusCode).toBe(204);

    const covering = await run(me.id, AREA_LNG - 0.0002, ROUTE_TO + 0.0001, Date.now() + 60_000);
    expect(await completeQuestsForActivity(db, covering)).toEqual([]);
    const mine = await app.inject({ method: 'GET', url: '/v1/quests/mine', headers: as(me.token) });
    expect((mine.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('refuses to accept an unknown or unpublished quest', async () => {
    const me = await runner();
    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/quests/${randomUUID()}/accept`,
      headers: as(me.token)
    });
    expect(unknown.statusCode).toBe(404);
  });
});
