import { withTransaction, type Database } from '@runsphere/db';
import {
  challengeModeScore,
  challengeWindow,
  challengeWinner,
  parseChallengeRule,
  type ChallengeMode,
  type ChallengeParticipantScore,
  type ChallengeRule,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Challenge finish scoring (ADR-0005, ADR-0006). Scores are derived in the
 * worker from server-derived activity only, never from client-reported totals,
 * and only pace-neutral modes are computed. The schema invariant this module
 * upholds: a challenge reaches `finished` in the same transaction that writes
 * its result rows, so a finished challenge always has a complete result.
 */
export const CHALLENGE_FINISHED_TOPIC = 'challenge.finished';

interface DueChallengeRow {
  id: string;
  mode: ChallengeMode;
  length_days: number;
  rule_version: string;
  period_start: Date | string;
  challenger_account_id: string;
  opponent_account_id: string;
}

interface ActivityRow {
  active_duration_seconds: number;
  processed_at: Date;
}

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * Cancel invites nobody answered before they lapsed, so a stale invite neither
 * lingers in a Play list nor blocks the one-open-challenge-per-pair rule.
 */
export const cancelExpiredChallengeInvites = async (db: Database): Promise<number> => {
  const cancelled = await db.query<{ id: string }>(
    `UPDATE challenges SET status = 'cancelled', responded_at = now()
     WHERE status = 'invited' AND invite_expires_at <= now()
     RETURNING id`
  );
  return cancelled.rows.length;
};

/**
 * Enqueue one `challenge.finished` event per active challenge whose window has
 * closed. The status stays `active` until the result is stored; the NOT EXISTS
 * guard makes a repeated sweep idempotent.
 */
export const enqueueDueChallenges = async (db: Database): Promise<number> => {
  const enqueued = await db.query<{ id: string }>(
    `INSERT INTO outbox_events (topic, aggregate_id, payload)
     SELECT $1, challenge.id, jsonb_build_object('challengeId', challenge.id::text)
     FROM challenges challenge
     WHERE challenge.status = 'active'
       AND challenge.period_end <= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT EXISTS (
         SELECT 1 FROM outbox_events existing
         WHERE existing.topic = $1 AND existing.aggregate_id = challenge.id
       )
     RETURNING id`,
    [CHALLENGE_FINISHED_TOPIC]
  );
  return enqueued.rows.length;
};

const loadChallengeRule = async (
  db: Database,
  ruleVersion: string
): Promise<ChallengeRule | undefined> => {
  const result = await db.query<{ definition: unknown }>(
    `SELECT definition FROM rule_versions WHERE kind = 'challenge' AND version = $1`,
    [Number(ruleVersion)]
  );
  const row = result.rows[0];
  // The rule version recorded on the challenge is authoritative even after a
  // newer version is published, so a finished window is never rescored under
  // rules the participants did not agree to.
  return row ? parseChallengeRule(row.definition) : undefined;
};

const derivedActivities = async (
  db: Database,
  accountId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<ScoredActivity[]> => {
  const result = await db.query<ActivityRow>(
    `SELECT output.active_duration_seconds, submission.processed_at
     FROM activity_submissions submission
     JOIN activity_validation_outputs output ON output.activity_id = submission.id
     WHERE submission.account_id = $1
       AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND submission.processed_at >= $2
       AND submission.processed_at < $3
     ORDER BY submission.processed_at`,
    [accountId, periodStart, periodEnd]
  );
  return result.rows.map((row) => ({
    activeDurationSeconds: row.active_duration_seconds,
    endedAt: row.processed_at
  }));
};

/**
 * Score both participants and store the result. Throws when the challenge is
 * gone or its mode is no longer scoreable, so the outbox retry/`failed_at`
 * machinery records the reason instead of writing a fabricated tie.
 */
export const scoreChallenge = async (db: Database, challengeId: string): Promise<boolean> => {
  const found = await db.query<DueChallengeRow>(
    `SELECT id, mode, length_days, rule_version, period_start,
            challenger_account_id, opponent_account_id
     FROM challenges WHERE id = $1 AND status = 'active'`,
    [challengeId]
  );
  const challenge = found.rows[0];
  // Already scored, cancelled, or the account (and its challenges) were erased.
  if (!challenge) return false;

  const rule = await loadChallengeRule(db, challenge.rule_version);
  if (!rule)
    throw new Error(`Challenge rule version ${challenge.rule_version} is no longer readable`);
  if (!rule.modes.includes(challenge.mode))
    throw new Error(`Challenge mode ${challenge.mode} is not scoreable under its rule version`);

  const window = challengeWindow(asDateString(challenge.period_start), challenge.length_days);
  const accountIds = [challenge.challenger_account_id, challenge.opponent_account_id] as const;
  const scores: ChallengeParticipantScore[] = [];
  for (const accountId of accountIds) {
    const activities = await derivedActivities(db, accountId, window.periodStart, window.periodEnd);
    scores.push({
      accountId,
      score: challengeModeScore(
        challenge.mode,
        window,
        activities,
        // Quest completions have no server record yet, so no rule enables the
        // `quest_completion` mode and this list is never the scoring input.
        [],
        rule.dailyCapMinutes,
        rule.minMinutesPerActiveDay
      )
    });
  }
  const winnerAccountId = challengeWinner(scores);

  await withTransaction(db, async (client) => {
    const claimed = await client.query<{ id: string }>(
      `UPDATE challenges SET status = 'finished', finished_at = now()
       WHERE id = $1 AND status = 'active' RETURNING id`,
      [challenge.id]
    );
    if (!claimed.rows[0]) return;
    await client.query(
      `INSERT INTO challenge_results (challenge_id, rule_version, winner_account_id)
       VALUES ($1, $2, $3) ON CONFLICT (challenge_id) DO NOTHING`,
      [challenge.id, challenge.rule_version, winnerAccountId ?? null]
    );
    for (const participant of scores) {
      await client.query(
        `INSERT INTO challenge_participant_results (challenge_id, account_id, score)
         VALUES ($1, $2, $3) ON CONFLICT (challenge_id, account_id) DO NOTHING`,
        [challenge.id, participant.accountId, participant.score]
      );
    }
    // The 014 inbox trigger fans each row out to `notification.created`; the
    // body carries no score, so a push payload can never leak one.
    for (const participant of scores) {
      await client.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
         VALUES ($1, 'challenge_finished', 'Challenge finished',
           'Your challenge is complete. Open it to see the result.', $2)`,
        [participant.accountId, `runsphere://challenges/${challenge.id}`]
      );
    }
  });
  return true;
};
