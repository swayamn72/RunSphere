import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import {
  ANTICHEAT_RETRAIN_INTERVAL_DAYS,
  processAnticheatRetrain,
  processQuestRecommendRetrain,
  readMlTrainerConfig
} from './ml-retrain-job.js';

const NOW = new Date('2026-10-01T00:05:00.000Z');

/**
 * A database that answers each read by the fragment it recognises, so a test
 * says what the world looks like rather than what order the job asks in.
 */
const fakeDb = (world: {
  lastProposalDaysAgo?: number;
  featureRows?: number;
  flaggedRows?: number;
  interactions?: number;
}) => {
  const writes: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes('INSERT INTO ml_models')) {
      writes.push({ sql, values });
      return { rows: [] };
    }
    if (sql.includes('FROM ml_models')) {
      return world.lastProposalDaysAgo === undefined
        ? { rows: [] }
        : {
            rows: [
              { proposed_at: new Date(NOW.getTime() - world.lastProposalDaysAgo * 86_400_000) }
            ]
          };
    }
    if (sql.includes('FILTER (WHERE ml_flagged)'))
      return {
        rows: [{ total: String(world.featureRows ?? 0), flagged: String(world.flaggedRows ?? 0) }]
      };
    if (sql.includes('FROM ml_run_features'))
      return { rows: [{ count: String(world.featureRows ?? 0) }] };
    if (sql.includes('FROM quest_interactions'))
      return { rows: [{ count: String(world.interactions ?? 0) }] };
    return { rows: [] };
  });
  return { query, writes, database: () => ({ query }) as unknown as Database };
};

const trainer = { url: 'http://trainer', timeoutMs: 1_000 };

const trainerAnswering = (body: unknown, ok = true) =>
  vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }));

describe('proposing an anti-cheat model', () => {
  it('does nothing when no training service is configured', async () => {
    const db = fakeDb({ featureRows: 50_000 });

    expect(await processAnticheatRetrain({ db: db.database() }, NOW)).toEqual({
      reason: 'not_configured'
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('waits a month between proposals', async () => {
    const db = fakeDb({ lastProposalDaysAgo: ANTICHEAT_RETRAIN_INTERVAL_DAYS - 1 });

    expect((await processAnticheatRetrain({ db: db.database(), trainer }, NOW)).reason).toBe(
      'not_due'
    );
  });

  it('proposes when a month has passed, without waiting for the 1st', async () => {
    // State-driven like the season jobs: a worker that was down on the 1st
    // still proposes when it comes back, instead of skipping the month.
    const db = fakeDb({
      lastProposalDaysAgo: ANTICHEAT_RETRAIN_INTERVAL_DAYS + 3,
      featureRows: 12_000,
      flaggedRows: 350
    });
    const fetchLike = trainerAnswering({
      version: 'anticheat_v2',
      trained_on_runs: 12_000,
      flag_rate: 0.031,
      metrics: { contamination: 0.03 }
    });

    const outcome = await processAnticheatRetrain(
      { db: db.database(), trainer, fetchLike: fetchLike as never },
      NOW
    );

    expect(outcome.reason).toBe('proposed');
    expect(outcome.proposed).toMatchObject({ kind: 'anticheat', version: 'anticheat_v2' });
  });

  it('never promotes what it proposes', async () => {
    // `ml.md` key constraint 4. The insert names no promotion columns at all,
    // so the row lands unpromoted and a reviewer has to act.
    const db = fakeDb({ featureRows: 12_000, flaggedRows: 350 });
    const fetchLike = trainerAnswering({
      version: 'anticheat_v2',
      trained_on_runs: 12_000,
      flag_rate: 0.031
    });

    await processAnticheatRetrain(
      { db: db.database(), trainer, fetchLike: fetchLike as never },
      NOW
    );

    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]?.sql).not.toContain('promoted_at');
    expect(db.writes[0]?.sql).not.toContain('promoted_by_account_id');
  });

  it('records the advice a reviewer will read, rather than acting on it', async () => {
    const db = fakeDb({ featureRows: 12_000, flaggedRows: 350 });
    const fetchLike = trainerAnswering({
      version: 'anticheat_bad',
      trained_on_runs: 12_000,
      // `ml.md`'s worked example: a model that suddenly flags 30%.
      flag_rate: 0.3
    });

    const outcome = await processAnticheatRetrain(
      { db: db.database(), trainer, fetchLike: fetchLike as never },
      NOW
    );

    // Still proposed — refusing to record it would hide the degradation.
    expect(outcome.reason).toBe('proposed');
    expect(outcome.proposed?.promotable).toBe(false);
    expect(String(db.writes[0]?.values?.[5])).toContain('describing the fleet, not the fraud');
  });

  it('does not train below the training-set floor', async () => {
    const db = fakeDb({ featureRows: 500 });
    const fetchLike = trainerAnswering({});

    expect(
      (
        await processAnticheatRetrain(
          { db: db.database(), trainer, fetchLike: fetchLike as never },
          NOW
        )
      ).reason
    ).toBe('below_floor');
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it('proposes nothing when the trainer cannot be reached', async () => {
    const db = fakeDb({ featureRows: 12_000 });

    const outcome = await processAnticheatRetrain(
      { db: db.database(), trainer, fetchLike: trainerAnswering({}, false) as never },
      NOW
    );

    expect(outcome.reason).toBe('trainer_unavailable');
    expect(db.writes).toHaveLength(0);
  });

  it('proposes nothing for an answer with no version in it', async () => {
    const db = fakeDb({ featureRows: 12_000 });

    const outcome = await processAnticheatRetrain(
      {
        db: db.database(),
        trainer,
        fetchLike: trainerAnswering({ trained_on_runs: 12_000 }) as never
      },
      NOW
    );

    expect(outcome.reason).toBe('trainer_unavailable');
  });
});

describe('proposing a quest recommender', () => {
  it('declines while nothing writes an interaction', async () => {
    // `045`: nothing accepts or completes a quest yet, so the view is empty.
    const db = fakeDb({ interactions: 0 });

    expect(
      (
        await processQuestRecommendRetrain(
          { db: db.database(), trainer, fetchLike: trainerAnswering({}) as never },
          NOW
        )
      ).reason
    ).toBe('below_floor');
  });

  it('proposes once the fleet has enough interactions', async () => {
    const db = fakeDb({ interactions: 900 });
    const fetchLike = trainerAnswering({
      version: 'recommend_v1',
      trained_on_runs: 900,
      metrics: { factors: 64 }
    });

    const outcome = await processQuestRecommendRetrain(
      { db: db.database(), trainer, fetchLike: fetchLike as never },
      NOW
    );

    expect(outcome.proposed).toMatchObject({ kind: 'quest_recommend', version: 'recommend_v1' });
    expect(db.writes[0]?.sql).not.toContain('promoted_at');
  });

  it('waits a week between proposals', async () => {
    const db = fakeDb({ lastProposalDaysAgo: 3, interactions: 900 });

    expect((await processQuestRecommendRetrain({ db: db.database(), trainer }, NOW)).reason).toBe(
      'not_due'
    );
  });
});

describe('trainer configuration', () => {
  it('is absent without a URL', () => {
    expect(readMlTrainerConfig({})).toBeUndefined();
  });

  it('allows minutes, because fitting is not a request', () => {
    expect(readMlTrainerConfig({ ML_TRAINER_URL: 'http://t' })?.timeoutMs).toBe(300_000);
  });
});
