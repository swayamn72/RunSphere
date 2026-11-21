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
 * M3.6 against real PostgreSQL: a runner can see the privacy zones they saved
 * and remove one, and nobody else can remove it.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'privacy-zones-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

let nextClient = 0;
const register = async (): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `198.51.100.${120 + (nextClient += 1)}`,
    payload: {
      email: `zones-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      ageAssertion: true,
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { accessToken: string }).accessToken;
};

const as = (token: string) => ({ authorization: `Bearer ${token}` });

describePostgis('privacy zones list and delete (M3.6)', () => {
  it('lists the owner’s zones newest first, and deletes one only for its owner', async () => {
    const owner = await register();
    const stranger = await register();

    const create = (name: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/privacy-zones',
        headers: as(owner),
        payload: { name, center: { latitude: 19.07, longitude: 72.88 } }
      });
    const home = await create('Home');
    const work = await create('Work');
    expect(home.statusCode).toBe(201);
    expect(work.statusCode).toBe(201);
    const homeId = (home.json() as { id: string }).id;

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/privacy-zones',
      headers: as(owner)
    });
    expect(listed.statusCode).toBe(200);
    const zones = (listed.json() as { data: { id: string; name: string; radiusMeters: number }[] })
      .data;
    expect(zones.map((zone) => zone.name)).toEqual(['Work', 'Home']);
    expect(zones.every((zone) => zone.radiusMeters === 200)).toBe(true);

    // Another account sees none of them and cannot remove one.
    const theirs = await app.inject({
      method: 'GET',
      url: '/v1/privacy-zones',
      headers: as(stranger)
    });
    expect((theirs.json() as { data: unknown[] }).data).toEqual([]);
    const refused = await app.inject({
      method: 'DELETE',
      url: `/v1/privacy-zones/${homeId}`,
      headers: as(stranger)
    });
    expect(refused.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/privacy-zones/${homeId}`,
      headers: as(owner)
    });
    expect(removed.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/v1/privacy-zones', headers: as(owner) });
    expect((after.json() as { data: { name: string }[] }).data.map((zone) => zone.name)).toEqual([
      'Work'
    ]);

    const again = await app.inject({
      method: 'DELETE',
      url: `/v1/privacy-zones/${homeId}`,
      headers: as(owner)
    });
    expect(again.statusCode).toBe(404);
  });

  it('asks for a sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/privacy-zones' })).statusCode).toBe(400);
  });
});
