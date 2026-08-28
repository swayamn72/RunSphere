import { randomUUID } from 'node:crypto';
import { createDatabase, defaultDatabaseUrl, migrate } from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { processActivity } from './activity.js';

const enabled = Boolean(
  process.env.RUN_POSTGIS_INTEGRATION && (process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD)
);
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'integration-test-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled) {
    await app.close();
    await db.end();
  }
});

describePostgis('M1 PostGIS activity flow', () => {
  it('persists adult registration, rotating session, and derived private activity', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: `pilot-${randomUUID()}-${Date.now()}@example.test`,
        password: 'a-safe-pilot-password',
        ageAssertion: true,
        policyVersion: 'm1'
      }
    });
    expect(register.statusCode).toBe(201);
    const auth = register.json() as { accessToken: string; refreshToken: string };
    const idempotencyKey = randomUUID();
    const activity = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': idempotencyKey },
      payload: { movementType: 'walk' }
    });
    expect(activity.statusCode).toBe(201);
    const id = (activity.json() as { id: string }).id;
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': idempotencyKey },
      payload: { movementType: 'walk' }
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { id: string }).id).toBe(id);
    const alteredReplay = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': idempotencyKey },
      payload: { movementType: 'run' }
    });
    expect(alteredReplay.statusCode).toBe(409);
    const concurrentKey = randomUUID();
    const concurrent = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/activities',
        headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': concurrentKey },
        payload: { movementType: 'hike' }
      }),
      app.inject({
        method: 'POST',
        url: '/v1/activities',
        headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': concurrentKey },
        payload: { movementType: 'hike' }
      })
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect((concurrent[0].json() as { id: string }).id).toBe(
      (concurrent[1].json() as { id: string }).id
    );
    const chunk = {
      sequence: 0,
      points: [
        { latitude: 19.076, longitude: 72.8777, recordedAt: '2026-08-27T10:00:00.000Z' },
        { latitude: 19.077, longitude: 72.8787, recordedAt: '2026-08-27T10:01:00.000Z' },
        { latitude: 19.078, longitude: 72.8797, recordedAt: '2026-08-27T10:02:00.000Z' },
        { latitude: 19.079, longitude: 72.8807, recordedAt: '2026-08-27T10:03:00.000Z' },
        { latitude: 19.08, longitude: 72.8817, recordedAt: '2026-08-27T10:04:00.000Z' }
      ]
    };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/activities/${id}/chunks`,
          headers: { authorization: `Bearer ${auth.accessToken}` },
          payload: chunk
        })
      ).statusCode
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${id}/finalize`,
          headers: { authorization: `Bearer ${auth.accessToken}` },
          payload: { expectedChunkCount: 1 }
        })
      ).statusCode
    ).toBe(202);
    expect(
      (await db.query('SELECT id FROM outbox_events WHERE aggregate_id = $1', [id])).rows
    ).toHaveLength(1);
    await processActivity(db, id);
    const derived = await db.query<{ route: string; applied_zones: unknown }>(
      'SELECT ST_AsGeoJSON(shareable_route) AS route, applied_zones FROM activity_derivations WHERE activity_id = $1',
      [id]
    );
    expect(derived.rows[0]?.route).toContain('MultiLineString');
    expect(derived.rows[0]?.applied_zones).toEqual([]);

    const zone = await app.inject({
      method: 'POST',
      url: '/v1/privacy-zones',
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { name: 'start', geometry: { type: 'Point', coordinates: [72.8777, 19.076] } }
    });
    expect(zone.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': randomUUID() },
      payload: { movementType: 'walk' }
    });
    const secondId = (second.json() as { id: string }).id;
    await app.inject({
      method: 'PUT',
      url: `/v1/activities/${secondId}/chunks`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: chunk
    });
    await app.inject({
      method: 'POST',
      url: `/v1/activities/${secondId}/finalize`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { expectedChunkCount: 1 }
    });
    await processActivity(db, secondId);
    const trimmed = await db.query<{
      route: string;
      applied_zones: Array<{ id: string; geometryVersion: number }>;
    }>(
      'SELECT ST_AsGeoJSON(shareable_route) AS route, applied_zones FROM activity_derivations WHERE activity_id = $1',
      [secondId]
    );
    expect(trimmed.rows[0]?.route).not.toContain('72.8777');
    expect(trimmed.rows[0]?.applied_zones[0]?.id).toBe((zone.json() as { id: string }).id);
    expect(trimmed.rows[0]?.applied_zones[0]?.geometryVersion).toBe(1);
  });
});
