import { createHash, randomUUID } from 'node:crypto';
import { activityFinalizeChecksumInput } from '@runsphere/contracts';
import { createDatabase, defaultDatabaseUrl, migrate } from '@runsphere/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { processActivity, chunkHash } from './activity.js';

const enabled = Boolean(
  process.env.RUN_POSTGIS_INTEGRATION && (process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD)
);
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'integration-test-secret' });
const sha256Chunks = (chunks: Array<{ sequence: number; points: unknown[] }>) =>
  createHash('sha256')
    .update(
      activityFinalizeChecksumInput(
        chunks.map((chunk) => ({ sequence: chunk.sequence, checksum: chunkHash(chunk) }))
      )
    )
    .digest('hex');

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
          headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'x-chunk-checksum': chunkHash(chunk)
          },
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
          payload: { expectedChunkCount: 1, checksum: sha256Chunks([chunk]) }
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
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'x-chunk-checksum': chunkHash(chunk)
      },
      payload: chunk
    });
    await app.inject({
      method: 'POST',
      url: `/v1/activities/${secondId}/finalize`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { expectedChunkCount: 1, checksum: sha256Chunks([chunk]) }
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

  it('resumes reordered chunks, rejects gaps, and exposes only trimmed history to its owner', async () => {
    const register = async (email: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email,
          password: 'a-safe-pilot-password',
          ageAssertion: true,
          policyVersion: 'm2'
        }
      });
      expect(response.statusCode).toBe(201);
      return response.json() as { accessToken: string };
    };
    const owner = await register(`m2-owner-${randomUUID()}@example.test`);
    const other = await register(`m2-other-${randomUUID()}@example.test`);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/activities',
      headers: { authorization: `Bearer ${owner.accessToken}`, 'idempotency-key': randomUUID() },
      payload: { movementType: 'run' }
    });
    const id = (create.json() as { id: string }).id;
    const chunks = [0, 1, 2].map((sequence) => ({
      sequence,
      points: [
        {
          latitude: 19.076 + sequence * 0.001,
          longitude: 72.8777 + sequence * 0.001,
          recordedAt: `2026-08-27T10:0${sequence}:00.000Z`
        }
      ]
    }));
    for (const sequence of [2, 0]) {
      const chunk = chunks[sequence]!;
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/v1/activities/${id}/chunks`,
            headers: {
              authorization: `Bearer ${owner.accessToken}`,
              'x-chunk-checksum': chunkHash(chunk)
            },
            payload: chunk
          })
        ).statusCode
      ).toBe(204);
    }
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/activities/${id}/chunks`,
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
            'x-chunk-checksum': chunkHash(chunks[2]!)
          },
          payload: chunks[2]
        })
      ).statusCode
    ).toBe(204);
    const incomplete = await app.inject({
      method: 'POST',
      url: `/v1/activities/${id}/finalize`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { expectedChunkCount: 3, checksum: sha256Chunks(chunks) }
    });
    expect(incomplete.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${id}`,
          headers: { authorization: `Bearer ${owner.accessToken}` }
        })
      ).json()
    ).toMatchObject({ missingSequences: [1] });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${id}/sync?expectedChunkCount=3`,
          headers: { authorization: `Bearer ${owner.accessToken}` }
        })
      ).json()
    ).toMatchObject({ status: 'received', missingSequences: [1] });
    const middle = chunks[1]!;
    await app.inject({
      method: 'PUT',
      url: `/v1/activities/${id}/chunks`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-chunk-checksum': chunkHash(middle)
      },
      payload: middle
    });
    const finalize = { expectedChunkCount: 3, checksum: sha256Chunks(chunks) };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/activities/${id}/chunks`,
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
            'x-chunk-checksum': chunkHash({ ...middle, points: [] })
          },
          payload: { ...middle, points: [] }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${id}/finalize`,
          headers: { authorization: `Bearer ${owner.accessToken}` },
          payload: finalize
        })
      ).statusCode
    ).toBe(202);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/activities/${id}/finalize`,
          headers: { authorization: `Bearer ${owner.accessToken}` },
          payload: finalize
        })
      ).statusCode
    ).toBe(202);
    await processActivity(db, id);
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/activities/${id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` }
    });
    expect(detail.json()).toMatchObject({
      status: 'derived',
      geometry: { type: 'MultiLineString' }
    });
    expect(JSON.stringify(detail.json())).not.toContain('recordedAt');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${id}`,
          headers: { authorization: `Bearer ${other.accessToken}` }
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/activities/${id}`,
          headers: { authorization: `Bearer ${owner.accessToken}` }
        })
      ).statusCode
    ).toBe(204);
    await processActivity(db, id);
    expect(
      (await db.query('SELECT id FROM activity_derivations WHERE activity_id = $1', [id])).rows
    ).toHaveLength(0);
  });
});
