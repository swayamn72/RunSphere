import { randomUUID } from 'node:crypto';
import { createDatabase, defaultDatabaseUrl, migrate } from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

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
        email: `pilot-${randomUUID()}@example.test`,
        password: 'a-safe-pilot-password',
        ageAssertion: true,
        policyVersion: 'm1'
      }
    });
    expect(register.statusCode).toBe(201);
    const auth = register.json() as { accessToken: string; refreshToken: string };
    const activity = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${auth.accessToken}`, 'idempotency-key': randomUUID() },
      payload: { movementType: 'walk' }
    });
    expect(activity.statusCode).toBe(201);
    const id = (activity.json() as { id: string }).id;
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
  });
});
