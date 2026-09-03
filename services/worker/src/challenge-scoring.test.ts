import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import {
  CHALLENGE_FINISHED_TOPIC,
  cancelExpiredChallengeInvites,
  enqueueDueChallenges,
  scoreChallenge
} from './challenge-scoring.js';

const CHALLENGER = '00000000-0000-4000-8000-00000000000a';
const OPPONENT = '00000000-0000-4000-8000-00000000000b';

const ruleDefinition = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  lengthDays: [3, 7],
  modes: ['active_minutes', 'active_days']
};

const challengeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'challenge-1',
  mode: 'active_minutes',
  length_days: 3,
  rule_version: '1',
  period_start: '2026-08-31',
  challenger_account_id: CHALLENGER,
  opponent_account_id: OPPONENT,
  ...overrides
});

const activity = (minutes: number, processedAt: string) => ({
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

/**
 * Routes SQL by fragment so a test states the data it is serving rather than
 * depending on call order.
 */
const scoringDatabase = (
  responses: {
    challenge?: Record<string, unknown>[];
    rule?: Record<string, unknown>[];
    activitiesByAccount?: Record<string, ReturnType<typeof activity>[]>;
    claimed?: Record<string, unknown>[];
  } = {}
) => {
  const clientCalls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const answer = async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes('FROM challenges WHERE id'))
      return { rows: responses.challenge ?? [challengeRow()] };
    if (sql.includes('FROM rule_versions'))
      return { rows: responses.rule ?? [{ definition: ruleDefinition }] };
    if (sql.includes('FROM activity_submissions'))
      return { rows: responses.activitiesByAccount?.[String(values?.[0])] ?? [] };
    return { rows: [] };
  };
  const clientQuery = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    clientCalls.push({ sql, values });
    if (sql.includes("SET status = 'finished'"))
      return { rows: responses.claimed ?? [{ id: 'challenge-1' }] };
    return { rows: [] };
  });
  const query = vi.fn(answer);
  const client = { query: clientQuery, release: vi.fn() };
  return {
    query,
    clientQuery,
    clientCalls,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    database(): Database {
      return this as unknown as Database;
    }
  };
};

const writes = (db: ReturnType<typeof scoringDatabase>, fragment: string) =>
  db.clientCalls.filter((call) => call.sql.includes(fragment));

describe('challenge sweep', () => {
  it('cancels only invites that lapsed without a response', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'challenge-1' }] });
    await expect(cancelExpiredChallengeInvites({ query } as never)).resolves.toBe(1);
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'invited'");
    expect(sql).toContain('invite_expires_at <= now()');
    expect(sql).toContain("SET status = 'cancelled'");
  });

  it('enqueues each closed window once and leaves the challenge active until it is scored', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'event-1' }] });
    await expect(enqueueDueChallenges({ query } as never)).resolves.toBe(1);
    const [sql, values] = query.mock.calls[0]! as [string, unknown[]];
    expect(values[0]).toBe(CHALLENGE_FINISHED_TOPIC);
    expect(sql).toContain("challenge.status = 'active'");
    expect(sql).toContain("(now() AT TIME ZONE 'Asia/Kolkata')::date");
    // The idempotence guard is what makes a repeated sweep safe.
    expect(sql).toContain('NOT EXISTS');
    expect(sql).not.toContain("SET status = 'finished'");
  });
});

describe('scoreChallenge', () => {
  it('stores capped per-participant scores, the winner, and one notice each', async () => {
    const db = scoringDatabase({
      activitiesByAccount: {
        [CHALLENGER]: [activity(90, '2026-08-31T09:00:00Z'), activity(30, '2026-08-31T18:00:00Z')],
        [OPPONENT]: [activity(45, '2026-09-01T09:00:00Z')]
      }
    });

    await expect(scoreChallenge(db.database(), 'challenge-1')).resolves.toBe(true);

    expect(writes(db, "SET status = 'finished'")).toHaveLength(1);
    const result = writes(db, 'INSERT INTO challenge_results')[0];
    expect(result?.values?.[2]).toBe(CHALLENGER);
    const participants = writes(db, 'INSERT INTO challenge_participant_results');
    expect(participants.map((call) => call.values?.slice(1))).toEqual([
      [CHALLENGER, 120],
      [OPPONENT, 45]
    ]);
    const notices = writes(db, 'INSERT INTO notification_inbox');
    expect(notices).toHaveLength(2);
    expect(notices.map((call) => call.values?.[0])).toEqual([CHALLENGER, OPPONENT]);
    // The title/body literals must carry no score: a push payload is built from
    // them, and only the opaque challenge id may travel in the deep link.
    expect(notices[0]?.sql).not.toMatch(/score|won|lost|minute|\bdays?\b/i);
    expect(notices.map((call) => String(call.values?.[1]))).toEqual([
      'runsphere://challenges/challenge-1',
      'runsphere://challenges/challenge-1'
    ]);
    expect(db.clientCalls[0]?.sql).toBe('BEGIN');
    expect(db.clientCalls.at(-1)?.sql).toBe('COMMIT');
  });

  it('records a tie with no winner rather than breaking it', async () => {
    const db = scoringDatabase({
      activitiesByAccount: {
        [CHALLENGER]: [activity(60, '2026-08-31T09:00:00Z')],
        [OPPONENT]: [activity(60, '2026-09-01T09:00:00Z')]
      }
    });

    await scoreChallenge(db.database(), 'challenge-1');

    expect(writes(db, 'INSERT INTO challenge_results')[0]?.values?.[2]).toBeNull();
  });

  it('scores a zero-activity window as zero rather than skipping the challenge', async () => {
    const db = scoringDatabase();

    await expect(scoreChallenge(db.database(), 'challenge-1')).resolves.toBe(true);

    expect(
      writes(db, 'INSERT INTO challenge_participant_results').map((call) => call.values?.[2])
    ).toEqual([0, 0]);
    expect(writes(db, 'INSERT INTO challenge_results')[0]?.values?.[2]).toBeNull();
  });

  it('reads the rule version recorded on the challenge, not the newest one', async () => {
    const db = scoringDatabase();
    await scoreChallenge(db.database(), 'challenge-1');
    const ruleCall = db.query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM rule_versions')
    );
    expect(String(ruleCall?.[0])).toContain('version = $1');
    expect(ruleCall?.[1]).toEqual([1]);
  });

  it('scores active_days from the published minimum minutes per day', async () => {
    const db = scoringDatabase({
      challenge: [challengeRow({ mode: 'active_days', length_days: 7 })],
      rule: [{ definition: { ...ruleDefinition, minMinutesPerActiveDay: 10 } }],
      activitiesByAccount: {
        [CHALLENGER]: [
          activity(4, '2026-08-31T09:00:00Z'), // below the 10-minute minimum
          activity(20, '2026-09-01T09:00:00Z'),
          activity(20, '2026-09-02T09:00:00Z')
        ],
        [OPPONENT]: [activity(30, '2026-09-01T09:00:00Z')]
      }
    });

    await scoreChallenge(db.database(), 'challenge-1');

    expect(
      writes(db, 'INSERT INTO challenge_participant_results').map((call) => call.values?.[2])
    ).toEqual([2, 1]);
  });

  it('reads only server-derived, non-deleted activity inside the window', async () => {
    const db = scoringDatabase();
    await scoreChallenge(db.database(), 'challenge-1');
    const activityCall = db.query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM activity_submissions')
    );
    const sql = String(activityCall?.[0]);
    expect(sql).toContain("submission.status = 'derived'");
    expect(sql).toContain('submission.deleted_at IS NULL');
    expect(sql).toContain('submission.processed_at >= $2');
    expect(sql).toContain('submission.processed_at < $3');
    // 2026-08-31 00:00 Asia/Kolkata through the 3-day window.
    expect((activityCall?.[1] as Date[])[1]?.toISOString()).toBe('2026-08-30T18:30:00.000Z');
    expect((activityCall?.[1] as Date[])[2]?.toISOString()).toBe('2026-09-02T18:30:00.000Z');
    // Pace, speed, and distance are never selected.
    expect(sql).not.toMatch(/distance|pace|speed|geometry|latitude|longitude/i);
  });

  it('treats an already-scored or erased challenge as nothing to do', async () => {
    const db = scoringDatabase({ challenge: [] });
    await expect(scoreChallenge(db.database(), 'challenge-1')).resolves.toBe(false);
    expect(db.clientCalls).toHaveLength(0);
  });

  it('fails loudly when the agreed rule version can no longer be read', async () => {
    const db = scoringDatabase({ rule: [] });
    await expect(scoreChallenge(db.database(), 'challenge-1')).rejects.toThrow(
      /rule version 1 is no longer readable/
    );
    expect(db.clientCalls).toHaveLength(0);
  });

  it('refuses to score a mode its rule version does not enable', async () => {
    const db = scoringDatabase({
      challenge: [challengeRow({ mode: 'quest_completion' })]
    });
    await expect(scoreChallenge(db.database(), 'challenge-1')).rejects.toThrow(
      /quest_completion is not scoreable/
    );
    expect(db.clientCalls).toHaveLength(0);
  });

  it('writes nothing when another worker claimed the same finish first', async () => {
    const db = scoringDatabase({ claimed: [] });
    await expect(scoreChallenge(db.database(), 'challenge-1')).resolves.toBe(true);
    expect(writes(db, 'INSERT INTO challenge_results')).toHaveLength(0);
    expect(writes(db, 'INSERT INTO notification_inbox')).toHaveLength(0);
  });
});
