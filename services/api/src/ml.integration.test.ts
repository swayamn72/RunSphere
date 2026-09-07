import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * The ML feature store, the model registry, and the recommendation endpoint,
 * against a real PostGIS (`ml.md`).
 *
 * What only a real database settles here:
 *
 *   * **A model cannot label its own training data.** The constraint that
 *     reserves `fraud` for a human is the difference between a model that
 *     improves and one that confirms itself, and a fake enforces no
 *     constraints at all.
 *   * **One live model per kind**, which is a partial unique index.
 *   * **`ST_Distance(::geography)` measures metres.** Without the cast the
 *     20 km filter is 20,000 degrees and every quest on earth is "near you" —
 *     the same class of bug the privacy-zone and route-suggestion tests exist
 *     for.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const SECRET = 'ml-integration-secret';
const app = buildApp({ db, authSecret: SECRET });

const BASE_LAT = 19.028;
const BASE_LNG = 72.838;

let account = '';
let reviewer = '';

const makeAccount = async (): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`ml-${randomUUID()}@example.test`]
  );
  return created.rows[0]!.id;
};

const makeActivity = async (): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, status,
       request_fingerprint, processed_at, raw_trace_retention_until)
     VALUES ($1, $2, 'run', 'derived', $2, now(), now() + interval '30 days')
     RETURNING id`,
    [account, randomUUID()]
  );
  return created.rows[0]!.id;
};

const insertFeatures = (
  activityId: string,
  overrides: {
    label?: string;
    labelSource?: string;
    flagged?: boolean;
    version?: string | null;
  } = {}
) =>
  db.query(
    `INSERT INTO ml_run_features (activity_submission_id, mean_speed_mps, total_distance_m,
       hour_of_day, label, label_source, ml_flagged, ml_model_version, ml_anomaly_score)
     VALUES ($1, 3.2, 2900, 6, $2, $3, $4, $5, $6)`,
    [
      activityId,
      overrides.label ?? 'legitimate',
      overrides.labelSource ?? 'rule_based',
      overrides.flagged ?? false,
      overrides.version === undefined ? null : overrides.version,
      overrides.flagged ? -0.7 : null
    ]
  );

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  account = await makeAccount();
  reviewer = await makeAccount();
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await app.close();
  if (account) {
    await db.query("DELETE FROM ml_models WHERE version LIKE 'itest_%'");
    await db.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[account, reviewer]]);
  }
  await db.end();
});

beforeEach(async () => {
  if (!enabled) return;
  await db.query('DELETE FROM activity_submissions WHERE account_id = $1', [account]);
  await db.query("DELETE FROM ml_models WHERE version LIKE 'itest_%'");
});

describePostgis('the ML feature store', () => {
  it('stores a run as numbers and nothing else', async () => {
    const activity = await makeActivity();
    await insertFeatures(activity);

    // Every column is a scalar. `ml.md`: a breach "must reveal nothing about
    // where anyone ran", and this asserts the table has nowhere to put a
    // coordinate rather than that nobody happened to write one.
    const columns = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'ml_run_features'`
    );
    const names = columns.rows.map((row) => row.column_name);

    expect(names).not.toContain('latitude');
    expect(names).not.toContain('longitude');
    expect(names).not.toContain('path');
    expect(names).not.toContain('geometry');
    expect(columns.rows.every((row) => row.data_type !== 'USER-DEFINED')).toBe(true);
  });

  it('refuses to let a model call a run fraud', async () => {
    // The loop this prevents: the model flags an unusual stride, the flag
    // becomes a fraud label, and the next model is more certain about it.
    const activity = await makeActivity();

    await expect(
      insertFeatures(activity, { label: 'fraud', labelSource: 'model_flag' })
    ).rejects.toThrow(/fraud_is_a_human_judgement/);
  });

  it('lets a model call a run suspicious', async () => {
    const activity = await makeActivity();

    await expect(
      insertFeatures(activity, { label: 'suspicious', labelSource: 'model_flag' })
    ).resolves.toBeDefined();
  });

  it('lets a human call a run fraud', async () => {
    const activity = await makeActivity();

    await expect(
      insertFeatures(activity, { label: 'fraud', labelSource: 'staff_review' })
    ).resolves.toBeDefined();
  });

  it('refuses a flag that does not name the model that made it', async () => {
    // `ml.md` key constraint 3: a disputed flag has to be replayable against
    // the artifact that produced it.
    const activity = await makeActivity();

    await expect(insertFeatures(activity, { flagged: true, version: null })).rejects.toThrow(
      /flag_names_its_model/
    );
    const another = await makeActivity();
    await expect(
      insertFeatures(another, { flagged: true, version: 'anticheat_v1' })
    ).resolves.toBeDefined();
  });

  it('keeps one row per submission', async () => {
    const activity = await makeActivity();
    await insertFeatures(activity);

    await expect(insertFeatures(activity)).rejects.toThrow(/activity_submission_id/);
  });

  it('takes features with the account when the account is erased', async () => {
    // Features outlive the raw trace; they do not outlive consent.
    const temporary = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
       VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
      [`ml-temp-${randomUUID()}@example.test`]
    );
    const temporaryId = temporary.rows[0]!.id;
    const activity = await db.query<{ id: string }>(
      `INSERT INTO activity_submissions (account_id, idempotency_key, movement_type, status,
         request_fingerprint, processed_at, raw_trace_retention_until)
       VALUES ($1, $2, 'run', 'derived', $2, now(), now() + interval '30 days') RETURNING id`,
      [temporaryId, randomUUID()]
    );
    await db.query(
      `INSERT INTO ml_run_features (activity_submission_id, mean_speed_mps) VALUES ($1, 3)`,
      [activity.rows[0]!.id]
    );

    await db.query('DELETE FROM accounts WHERE id = $1', [temporaryId]);

    const left = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ml_run_features WHERE activity_submission_id = $1',
      [activity.rows[0]!.id]
    );
    expect(Number(left.rows[0]!.count)).toBe(0);
  });
});

describePostgis('the model registry', () => {
  const propose = (version: string) =>
    db.query(
      `INSERT INTO ml_models (kind, version, trained_on_runs, flag_rate)
       VALUES ('anticheat', $1, 12000, 0.03)`,
      [version]
    );

  it('accepts a proposal that nobody has promoted', async () => {
    await expect(propose('itest_v1')).resolves.toBeDefined();

    const row = await db.query<{ promoted_at: Date | null }>(
      "SELECT promoted_at FROM ml_models WHERE version = 'itest_v1'"
    );
    expect(row.rows[0]?.promoted_at).toBeNull();
  });

  it('refuses a promotion nobody signed', async () => {
    await propose('itest_v1');

    await expect(
      db.query("UPDATE ml_models SET promoted_at = now() WHERE version = 'itest_v1'")
    ).rejects.toThrow(/promotion_is_signed/);
  });

  it('allows a signed promotion', async () => {
    await propose('itest_v1');

    await expect(
      db.query(
        `UPDATE ml_models SET promoted_at = now(), promoted_by_account_id = $1
         WHERE version = 'itest_v1'`,
        [reviewer]
      )
    ).resolves.toBeDefined();
  });

  it('keeps exactly one model live per kind', async () => {
    await propose('itest_v1');
    await propose('itest_v2');
    await db.query(
      `UPDATE ml_models SET promoted_at = now(), promoted_by_account_id = $1
       WHERE version = 'itest_v1'`,
      [reviewer]
    );

    await expect(
      db.query(
        `UPDATE ml_models SET promoted_at = now(), promoted_by_account_id = $1
         WHERE version = 'itest_v2'`,
        [reviewer]
      )
    ).rejects.toThrow(/one_live_per_kind/);

    // Retiring the first makes room for the second.
    await db.query("UPDATE ml_models SET retired_at = now() WHERE version = 'itest_v1'");
    await expect(
      db.query(
        `UPDATE ml_models SET promoted_at = now(), promoted_by_account_id = $1
         WHERE version = 'itest_v2'`,
        [reviewer]
      )
    ).resolves.toBeDefined();
  });

  it('refuses to retire something that was never live', async () => {
    await propose('itest_v1');

    await expect(
      db.query("UPDATE ml_models SET retired_at = now() WHERE version = 'itest_v1'")
    ).rejects.toThrow(/retired_was_promoted/);
  });

  it('published both rules the engines read', async () => {
    const rules = await db.query<{ kind: string; definition: Record<string, unknown> }>(
      `SELECT kind, definition FROM rule_versions
       WHERE kind IN ('ml_anticheat', 'quest_recommend') AND version = 1`
    );
    const byKind = new Map(rules.rows.map((row) => [row.kind, row.definition]));

    expect(byKind.get('ml_anticheat')).toMatchObject({
      trainingSetFloor: 2000,
      holdThreshold: -0.3,
      neverAutoRejects: true
    });
    expect(byKind.get('quest_recommend')).toMatchObject({ limit: 5, radiusMetres: 20000 });
  });
});

describePostgis('quest interactions', () => {
  it('exists, which ml.md assumed and 008 did not provide', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('quest_acceptances', 'quest_completions')`
    );

    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      'quest_acceptances',
      'quest_completions'
    ]);
  });

  it('is empty, because nothing writes one yet', async () => {
    // Stated as a test rather than a comment: the day something does start
    // writing, this fails and somebody re-reads `045`.
    const counted = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM quest_interactions'
    );

    expect(Number(counted.rows[0]!.count)).toBe(0);
  });

  it('weights a completion above an acceptance, and an abandonment at zero', async () => {
    const quest = await db.query<{ id: string }>(
      `INSERT INTO quest_versions (quest_key, version, title, distance_meters,
         estimated_active_minutes, accessibility, open_hours, provenance,
         source_reviewed_at, published_at)
       VALUES ($1, 1, 'Test Loop', 3000, 20, 'step-free', '{}'::jsonb, '{}'::jsonb, now(), now())
       RETURNING id`,
      [`ml-quest-${randomUUID()}`]
    );
    const questId = quest.rows[0]!.id;
    try {
      await db.query(
        'INSERT INTO quest_acceptances (account_id, quest_version_id) VALUES ($1, $2)',
        [account, questId]
      );
      const accepted = await db.query<{ weight: number }>(
        'SELECT weight FROM quest_interactions WHERE account_id = $1',
        [account]
      );
      expect(Number(accepted.rows[0]!.weight)).toBe(1);

      await db.query(
        'INSERT INTO quest_completions (account_id, quest_version_id) VALUES ($1, $2)',
        [account, questId]
      );
      const completed = await db.query<{ weight: number }>(
        'SELECT weight FROM quest_interactions WHERE account_id = $1',
        [account]
      );
      expect(Number(completed.rows[0]!.weight)).toBe(2);

      await db.query('DELETE FROM quest_completions WHERE account_id = $1', [account]);
      await db.query('UPDATE quest_acceptances SET abandoned_at = now() WHERE account_id = $1', [
        account
      ]);
      const abandoned = await db.query<{ weight: number }>(
        'SELECT weight FROM quest_interactions WHERE account_id = $1',
        [account]
      );
      // Kept as an explicit zero: "tried it and stopped" is distinguishable
      // from "never saw it", and `ml.md` wants the engine to learn from both.
      expect(Number(abandoned.rows[0]!.weight)).toBe(0);
    } finally {
      await db.query('DELETE FROM quest_acceptances WHERE account_id = $1', [account]);
      await db.query('DELETE FROM quest_versions WHERE id = $1', [questId]);
    }
  });
});

describePostgis('GET /v1/quests/recommended', () => {
  const ask = (latitude = BASE_LAT, longitude = BASE_LNG) =>
    app.inject({
      method: 'GET',
      url: `/v1/quests/recommended?latitude=${latitude}&longitude=${longitude}`,
      headers: { authorization: `Bearer ${createAccessToken(account, SECRET)}` }
    });

  it('is honest that the list is by distance, not by taste', async () => {
    // The state this ships in and stays in until the quest lifecycle exists.
    const body = (await ask()).json();

    expect(body.basis).toBe('proximity');
    expect(body.note).toMatch(/close they are|No quests near you/);
  });

  it('needs a signed-in account', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/quests/recommended?latitude=${BASE_LAT}&longitude=${BASE_LNG}`
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a position that is not one', async () => {
    expect((await ask(999, BASE_LNG)).statusCode).toBe(400);
  });

  it('measures the radius in metres, not degrees', async () => {
    // Without the `::geography` casts, 20,000 "degrees" is the whole planet.
    // Asked from the South Atlantic, nothing in Mumbai may come back.
    const body = (await ask(-40, -20)).json();

    expect(body.data).toEqual([]);
  });
});

describe('the PostGIS gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
