import { createHash, randomUUID } from 'node:crypto';
import { activityFinalizeChecksumInput } from '@runsphere/contracts';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi,
  withTransaction,
  type Database
} from '@runsphere/db';
import type { RunMetrics } from '@runsphere/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { chunkHash, processActivity } from './activity.js';
import { weeklyGoalResponse } from './quest-routes.js';

/**
 * B8 and B9 against real PostgreSQL: activity processing is one transaction,
 * so a failure halfway leaves nothing behind and a retry succeeds, and a run
 * with no points ends `rejected` instead of stuck in `validating`. Also M9 9.9:
 * a derived run has its metrics.
 *
 * Every account this suite registers is erased afterwards, so suites that run
 * later against the same database don't see its runs (B19).
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'activity-processing-integration-secret' });

const createdAccounts: string[] = [];
const accountIdOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).sub as string;

beforeAll(async () => {
  if (enabled) await migrate(db);
});
afterAll(async () => {
  if (enabled) {
    // Registration writes consent history, which only an erasure may delete.
    await withTransaction(db, async (client) => {
      await client.query("SELECT set_config('runsphere.account_erasure', 'on', true)");
      await client.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [createdAccounts]);
    });
  }
  await app.close();
  await db.end();
});

let nextClient = 0;
const register = async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    remoteAddress: `203.0.113.${(nextClient += 1)}`,
    payload: {
      email: `processing-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      dateOfBirth: '1990-01-01',
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const token = (response.json() as { accessToken: string }).accessToken;
  createdAccounts.push(accountIdOf(token));
  return token;
};

/** A finalized activity in `validating`, with a short synthetic trace. */
const finalizedActivity = async (token: string, withAltitude = false) => {
  const headers = { authorization: `Bearer ${token}` };
  const created = await app.inject({
    method: 'POST',
    url: '/v1/activities',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { movementType: 'run' }
  });
  expect(created.statusCode).toBe(201);
  const id = (created.json() as { id: string }).id;
  const chunk = {
    sequence: 0,
    points: Array.from({ length: 6 }, (_, index) => ({
      latitude: 1.0 + index * 0.0001,
      longitude: 1.0,
      recordedAt: new Date(Date.UTC(2026, 10, 1, 6, 0, index * 5)).toISOString(),
      accuracyMeters: 5,
      ...(withAltitude ? { altitudeMeters: 10 + index * 4 } : {})
    }))
  };
  const put = await app.inject({
    method: 'PUT',
    url: `/v1/activities/${id}/chunks`,
    headers: { ...headers, 'x-chunk-checksum': chunkHash(chunk) },
    payload: chunk
  });
  expect(put.statusCode).toBe(204);
  const finalize = await app.inject({
    method: 'POST',
    url: `/v1/activities/${id}/finalize`,
    headers,
    payload: {
      expectedChunkCount: 1,
      checksum: createHash('sha256')
        .update(activityFinalizeChecksumInput([{ sequence: 0, checksum: chunkHash(chunk) }]))
        .digest('hex')
    }
  });
  expect(finalize.statusCode).toBe(202);
  return id;
};

const statusOf = async (id: string) =>
  (
    await db.query<{ status: string; rejection_reason: string | null }>(
      'SELECT status, rejection_reason FROM activity_submissions WHERE id = $1',
      [id]
    )
  ).rows[0];

const countRows = async (table: string, id: string) =>
  Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE activity_id = $1`,
        [id]
      )
    ).rows[0]!.count
  );

/**
 * The real database, except that one statement fails inside the transaction,
 * standing in for a crash halfway through processing.
 */
const failingOn = (fragment: string): Database => ({
  query: (text, values) => db.query(text, values),
  end: () => Promise.resolve(),
  connect: async () => {
    const client = await db.connect();
    const query = client.query.bind(client) as (text: string, values?: unknown[]) => unknown;
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property !== 'query') return Reflect.get(target, property, receiver);
        return (text: string, values?: unknown[]) =>
          typeof text === 'string' && text.includes(fragment)
            ? Promise.reject(new Error('simulated crash'))
            : query(text, values);
      }
    });
  }
});

describePostgis('activity processing (B8, B9)', () => {
  it('rolls back every write when processing fails halfway, then succeeds on retry', async () => {
    const id = await finalizedActivity(await register());

    await expect(
      processActivity(failingOn('INSERT INTO activity_validation_runs'), id)
    ).rejects.toThrow('simulated crash');

    // Nothing from the failed attempt survived, and the run is still waiting.
    expect((await statusOf(id))?.status).toBe('validating');
    expect(await countRows('activity_derivations', id)).toBe(0);
    expect(await countRows('activity_validation_outputs', id)).toBe(0);
    expect(await countRows('activity_validation_runs', id)).toBe(0);

    await processActivity(db, id);
    await processActivity(db, id); // a replay after success is a no-op

    expect((await statusOf(id))?.status).toBe('derived');
    expect(await countRows('activity_derivations', id)).toBe(1);
    expect(await countRows('activity_validation_runs', id)).toBe(1);
  });

  it('rejects a run whose points are gone instead of leaving it validating', async () => {
    const id = await finalizedActivity(await register());
    await db.query('DELETE FROM activity_chunks WHERE activity_id = $1', [id]);

    await processActivity(db, id);

    expect(await statusOf(id)).toEqual({ status: 'rejected', rejection_reason: 'no_points' });
    expect(await countRows('activity_metrics', id)).toBe(0);
  });

  it('stores the metrics of a derived run once, with elevation when points carry altitude (9.9)', async () => {
    const id = await finalizedActivity(await register(), true);

    await processActivity(db, id);
    await processActivity(db, id);

    const rows = await db.query<{
      metrics_version: number;
      metrics: RunMetrics;
      moving_seconds: number;
      elevation_gain_meters: number | null;
    }>(
      'SELECT metrics_version, metrics, moving_seconds, elevation_gain_meters FROM activity_metrics WHERE activity_id = $1',
      [id]
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    const output = await db.query<{ distance_meters: number }>(
      'SELECT distance_meters FROM activity_validation_outputs WHERE activity_id = $1',
      [id]
    );
    // Same segments as validation, so the same distance.
    expect(row.metrics.distanceMeters).toBeCloseTo(output.rows[0]!.distance_meters, 0);
    expect(row.metrics_version).toBe(row.metrics.metricsVersion);
    expect(row.moving_seconds).toBe(25);
    expect(row.elevation_gain_meters).toBeGreaterThan(5);
    expect(JSON.stringify(row.metrics)).not.toMatch(/latitude|longitude/);
  });

  it('returns the metrics with the run detail, and none for a run without them (9.11)', async () => {
    const token = await register();
    const id = await finalizedActivity(token, true);
    await processActivity(db, id);
    const detail = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/activities/${id}`,
          headers: { authorization: `Bearer ${token}` }
        })
      ).json() as { status: string; metrics?: RunMetrics };

    const { status, metrics } = await detail();
    expect(status).toBe('derived');
    const stored = await db.query<{ metrics: RunMetrics }>(
      'SELECT metrics FROM activity_metrics WHERE activity_id = $1',
      [id]
    );
    // Everything stored survives the response schema, series tuples included.
    expect(metrics).toEqual(stored.rows[0]!.metrics);
    expect(metrics!.paceSeries.length).toBeGreaterThan(0);
    expect(metrics!.paceSeries[0]).toHaveLength(2);
    expect(metrics!.elevation).not.toBeNull();

    // A run derived before metrics, its points since purged.
    await db.query('DELETE FROM activity_metrics WHERE activity_id = $1', [id]);
    expect(await detail()).not.toHaveProperty('metrics');
  });

  it("never returns another runner's metrics", async () => {
    const id = await finalizedActivity(await register());
    await processActivity(db, id);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/activities/${id}`,
      headers: { authorization: `Bearer ${await register()}` }
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('activity processing integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});

describePostgis('weekly goal week boundary (B10)', () => {
  it('counts a run at 00:30 Monday in India toward the new Kolkata week', async () => {
    const accountId = accountIdOf(await register());
    // 2026-11-15 is a Sunday. 19:00 UTC is 00:30 IST on Monday 16 November.
    const processedAt = new Date('2026-11-15T19:00:00.000Z');
    const run = await db.query<{ id: string }>(
      `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, request_fingerprint,
         status, processed_at, finalized_at)
       VALUES ($1, $2, 'run', 'fixture', 'derived', $3, $3) RETURNING id`,
      [accountId, randomUUID(), processedAt]
    );
    await db.query(
      `INSERT INTO activity_validation_outputs (activity_id, active_duration_seconds, distance_meters,
         accepted_point_count, rejected_point_count, rejected_gap_count, validation_algorithm_version)
       VALUES ($1, 1200, 3000, 100, 0, 0, 'fixture')`,
      [run.rows[0]!.id]
    );

    // An hour later, still Monday in India: the run is this week's.
    const monday = await weeklyGoalResponse(db, accountId, new Date('2026-11-15T20:00:00.000Z'));
    expect(monday.weekStartsOn).toBe('2026-11-16');
    expect(monday.activeMinutes.actual).toBe(20);
    expect(monday.distanceMeters.actual).toBe(3000);

    // Earlier that Sunday evening in India, the run has not happened yet in
    // that week's window, and the week is the previous one.
    const sunday = await weeklyGoalResponse(db, accountId, new Date('2026-11-15T17:00:00.000Z'));
    expect(sunday.weekStartsOn).toBe('2026-11-09');
    expect(sunday.activeMinutes.actual).toBe(0);
  });
});
