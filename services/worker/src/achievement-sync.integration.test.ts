import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled
} from '@runsphere/db';
import { buildApp } from '@runsphere/api';
import { syncAchievementsForActivity } from '@runsphere/api/achievements';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M1.7 against real PostgreSQL: the worker awards achievements as a run is
 * derived, without the runner opening the Achievements screen, and never
 * awards twice.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'achievement-sync-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

const register = async (): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
    payload: {
      email: `ach-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      ageAssertion: true,
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const { accessToken } = response.json() as { accessToken: string };
  return JSON.parse(Buffer.from(accessToken.split('.')[0]!, 'base64url').toString()).sub as string;
};

const run = async (accountId: string, status: 'derived' | 'rejected') => {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, request_fingerprint,
       status, processed_at, finalized_at)
     VALUES ($1, $2, 'run', 'fixture', $3, now(), now()) RETURNING id`,
    [accountId, randomUUID(), status]
  );
  const id = inserted.rows[0]!.id;
  if (status === 'derived')
    await db.query(
      `INSERT INTO activity_validation_outputs (activity_id, active_duration_seconds, distance_meters,
         accepted_point_count, rejected_point_count, rejected_gap_count, validation_algorithm_version)
       VALUES ($1, 1800, 5000, 50, 0, 0, 'fixture')`,
      [id]
    );
  return id;
};

const awards = async (accountId: string) =>
  (
    await db.query<{ achievement_key: string }>(
      'SELECT achievement_key FROM achievement_awards WHERE account_id = $1 ORDER BY achievement_key',
      [accountId]
    )
  ).rows.map((row) => row.achievement_key);

describePostgis('achievements awarded by the worker (M1.7)', () => {
  it('awards First Steps when the first run is derived, with its XP, exactly once', async () => {
    const accountId = await register();
    const activityId = await run(accountId, 'derived');

    const first = await syncAchievementsForActivity(db, activityId);
    expect(first).toEqual({ status: 'synced', newlyAwarded: expect.any(Number) });
    expect(await awards(accountId)).toContain('first_steps');

    const xp = await db.query<{ amount: number }>(
      `SELECT amount FROM xp_entries WHERE account_id = $1 AND dedupe_key = 'achievement:first_steps'`,
      [accountId]
    );
    expect(xp.rows).toHaveLength(1);

    // A retried event, or the screen's sync racing the worker, adds nothing.
    expect(await syncAchievementsForActivity(db, activityId)).toEqual({
      status: 'synced',
      newlyAwarded: 0
    });
    const xpAgain = await db.query(
      `SELECT 1 FROM xp_entries WHERE account_id = $1 AND dedupe_key = 'achievement:first_steps'`,
      [accountId]
    );
    expect(xpAgain.rows).toHaveLength(1);
  });

  it('skips a rejected run: it changes no achievement', async () => {
    const accountId = await register();
    const activityId = await run(accountId, 'rejected');

    expect(await syncAchievementsForActivity(db, activityId)).toBeUndefined();
    expect(await awards(accountId)).toEqual([]);
  });
});
