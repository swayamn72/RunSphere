import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { kolkataDate, weeklyPeriodStart } from '@runsphere/domain';
import { buildApp } from '@runsphere/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processProgressionWeekClose } from './progression-week-close.js';

/**
 * B2 against real PostgreSQL: a closed week's activity XP is persisted by the
 * worker, so it survives the Monday rollover, and finalizing twice writes
 * nothing new.
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'progression-week-close-integration-secret' });

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

const register = async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
    payload: {
      email: `xp-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-01-01',
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const { accessToken } = response.json() as { accessToken: string };
  return {
    accessToken,
    accountId: JSON.parse(Buffer.from(accessToken.split('.')[0]!, 'base64url').toString())
      .sub as string
  };
};

/** A derived run of `seconds` active time, processed at `processedAt`. */
const derivedRun = async (accountId: string, processedAt: Date, seconds: number) => {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, request_fingerprint,
       status, processed_at, finalized_at)
     VALUES ($1, $2, 'run', 'fixture', 'derived', $3, $3) RETURNING id`,
    [accountId, randomUUID(), processedAt]
  );
  await db.query(
    `INSERT INTO activity_validation_outputs (activity_id, active_duration_seconds, distance_meters,
       accepted_point_count, rejected_point_count, rejected_gap_count, validation_algorithm_version)
     VALUES ($1, $2, 1000, 50, 0, 0, 'fixture')`,
    [inserted.rows[0]!.id, seconds]
  );
};

const xpFor = async (accountId: string, periodStart: string) =>
  (
    await db.query<{ source: string; amount: number }>(
      `SELECT source, amount FROM xp_entries WHERE account_id = $1 AND period_start = $2::date
       ORDER BY source`,
      [accountId, periodStart]
    )
  ).rows;

describePostgis('progression week close (B2)', () => {
  it('persists last week’s XP and does not double it on a second pass', async () => {
    const me = await register();
    const now = new Date();
    const thisWeek = weeklyPeriodStart(now);
    // Mid-morning on the Tuesday of last week, Kolkata time.
    const lastWeek = new Date(thisWeek.getTime() - 7 * 86_400_000);
    const lastWeekId = kolkataDate(lastWeek);
    await derivedRun(
      me.accountId,
      new Date(lastWeek.getTime() + 86_400_000 + 4 * 3_600_000),
      30 * 60
    );

    // In production a run is always processed in the open week, so a week has
    // never been finalized before its runs exist. This fixture writes into a
    // past week, and a persistent test database may already have closed it in
    // an earlier run, so reopen it (and anything later) to match reality.
    await db.query(
      'UPDATE weekly_periods SET progression_finalized_at = NULL WHERE period_start >= $1::date',
      [lastWeekId]
    );

    // The job takes one week per sweep, oldest first, and the test database
    // may hold other unfinalized weeks; sweep until ours is done.
    for (let sweep = 0; sweep < 25; sweep += 1) {
      const outcome = await processProgressionWeekClose({ db }, now);
      if (outcome.week === lastWeekId || outcome.week === undefined) break;
    }

    // Rule v1: 1 XP per active minute and 20 per active day.
    expect(await xpFor(me.accountId, lastWeekId)).toEqual([
      { source: 'active_day_consistency', amount: 20 },
      { source: 'active_minutes', amount: 30 }
    ]);
    const period = await db.query<{ finalized: boolean }>(
      `SELECT progression_finalized_at IS NOT NULL AS finalized FROM weekly_periods
       WHERE period_start = $1::date`,
      [lastWeekId]
    );
    expect(period.rows[0]?.finalized).toBe(true);

    // A second pass writes nothing new.
    await processProgressionWeekClose({ db }, now);
    expect(await xpFor(me.accountId, lastWeekId)).toHaveLength(2);

    // And it now counts in the lifetime total the app reads.
    const summary = await app.inject({
      method: 'GET',
      url: '/v1/progression',
      headers: { authorization: `Bearer ${me.accessToken}` }
    });
    expect(summary.json()).toMatchObject({ totalXp: 50 });
  });

  it('never finalizes the current, still-open week', async () => {
    const me = await register();
    const now = new Date();
    await derivedRun(me.accountId, new Date(now.getTime() - 60_000), 10 * 60);

    for (let sweep = 0; sweep < 25; sweep += 1) {
      if ((await processProgressionWeekClose({ db }, now)).week === undefined) break;
    }

    expect(await xpFor(me.accountId, kolkataDate(weeklyPeriodStart(now)))).toEqual([]);
  });
});

describe('progression week close integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
