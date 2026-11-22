import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi,
  withTransaction
} from '@runsphere/db';
import { RUN_METRICS_VERSION } from '@runsphere/domain';
import { buildApp } from '@runsphere/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processActivityMetricsBackfill } from './activity-metrics-backfill.js';
import { maintenanceJobs } from './worker.js';

/**
 * M9 9.10 against real PostgreSQL: derived runs without metrics get them while
 * their raw points exist; purged, deleted and up-to-date runs are left alone.
 * Accounts are erased afterwards so later suites don't see these runs (B19).
 */

const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const app = buildApp({ db, authSecret: 'activity-metrics-backfill-integration-secret' });
const createdAccounts: string[] = [];

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
    remoteAddress: `198.51.100.${(nextClient += 1)}`,
    payload: {
      email: `metrics-${randomUUID()}@example.test`,
      password: 'a-safe-pilot-password',
      ageAssertion: true,
      policyVersion: 'm2'
    }
  });
  expect(response.statusCode).toBe(201);
  const { accessToken } = response.json() as { accessToken: string };
  const accountId = JSON.parse(Buffer.from(accessToken.split('.')[0]!, 'base64url').toString())
    .sub as string;
  createdAccounts.push(accountId);
  return accountId;
};

/** A derived run with a 2-minute synthetic trace, as if derived before metrics existed. */
const derivedRun = async (accountId: string, { purged = false, deleted = false } = {}) => {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, request_fingerprint,
       status, processed_at, finalized_at, raw_trace_purged_at, deleted_at)
     VALUES ($1, $2, 'run', 'fixture', 'derived', now(), now(),
       CASE WHEN $3 THEN now() END, CASE WHEN $4 THEN now() END) RETURNING id`,
    [accountId, randomUUID(), purged, deleted]
  );
  const id = inserted.rows[0]!.id;
  if (!purged) {
    const points = Array.from({ length: 121 }, (_, index) => ({
      latitude: 1 + index * 0.00003,
      longitude: 1,
      recordedAt: new Date(Date.UTC(2026, 10, 1, 6, 0, index)).toISOString(),
      accuracyMeters: 5
    }));
    await db.query(
      `INSERT INTO activity_chunks (activity_id, sequence, payload, payload_hash, encoding,
         compressed_bytes, uncompressed_bytes)
       VALUES ($1, 0, $2::jsonb, 'fixture', 'identity', 1, 1)`,
      [id, JSON.stringify({ sequence: 0, points })]
    );
  }
  return id;
};

const metricsOf = async (id: string) =>
  (
    await db.query<{ metrics_version: number; moving_seconds: number }>(
      'SELECT metrics_version, moving_seconds FROM activity_metrics WHERE activity_id = $1',
      [id]
    )
  ).rows[0];

describePostgis('activity metrics backfill (M9 9.10)', () => {
  it('fills in runs whose points remain, once, and skips purged and deleted runs', async () => {
    const accountId = await register();
    const pending = await derivedRun(accountId);
    const purged = await derivedRun(accountId, { purged: true });
    const deleted = await derivedRun(accountId, { deleted: true });

    // Other suites' runs may be due too, so drain rather than count one batch.
    while ((await processActivityMetricsBackfill(db)) > 0);

    expect(await metricsOf(pending)).toEqual({
      metrics_version: RUN_METRICS_VERSION,
      moving_seconds: 120
    });
    expect(await metricsOf(purged)).toBeUndefined();
    expect(await metricsOf(deleted)).toBeUndefined();
  });

  it('leaves metrics already at the current version alone', async () => {
    const id = await derivedRun(await register());
    await db.query(
      `INSERT INTO activity_metrics (activity_id, metrics_version, metrics, moving_seconds)
       VALUES ($1, $2, '{}'::jsonb, 7)`,
      [id, RUN_METRICS_VERSION]
    );
    while ((await processActivityMetricsBackfill(db)) > 0);
    expect(await metricsOf(id)).toEqual({
      metrics_version: RUN_METRICS_VERSION,
      moving_seconds: 7
    });
  });
});

describe('activity metrics backfill in the sweep', () => {
  it('runs before the raw trace purge', () => {
    const names = maintenanceJobs.map((job) => job.name);
    expect(names).toContain('activity_metrics_backfill');
    expect(names.indexOf('activity_metrics_backfill')).toBeLessThan(
      names.indexOf('raw_trace_purge')
    );
  });
});

describe('activity metrics backfill integration gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
