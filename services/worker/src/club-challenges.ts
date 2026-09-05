import { withTransaction, type Database } from '@runsphere/db';
import {
  challengeModeScore,
  challengeWindow,
  competitionRanking,
  parseChallengeRule,
  type ChallengeMode,
  type ChallengeRule,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Club challenge finalization (Phase 3, milestone 3.4).
 *
 * Scores are derived here and nowhere else: the client never reports a total,
 * and the API only ever computes a *live, provisional* standing for a window
 * that is still open. Once the window closes this job writes the result once,
 * in the same transaction that marks the challenge finished, so a finished
 * contest always has a complete result and never changes afterwards
 * (ADR-0005, ADR-0006).
 *
 * Unlike the 1v1 flow there is no outbox row. The `status = 'active'` claim is
 * itself the idempotence: a crashed or failed sweep leaves the challenge
 * active, so the next pass simply tries again, and a challenge that has already
 * been scored is not selected at all.
 */

interface DueChallengeRow {
  id: string;
  club_id: string;
  mode: ChallengeMode;
  length_days: number;
  period_start: Date | string;
  rule_version: number;
}

interface ActivityRow {
  account_id: string;
  active_duration_seconds: number;
  processed_at: Date;
}

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * The rule version recorded on the challenge, not the newest one. A contest is
 * always scored under the rules its participants joined, even if a newer rule
 * has been published since.
 */
const loadRule = async (db: Database, version: number): Promise<ChallengeRule | undefined> => {
  const result = await db.query<{ definition: unknown }>(
    `SELECT definition FROM rule_versions WHERE kind = 'club_challenge' AND version = $1`,
    [version]
  );
  const row = result.rows[0];
  return row ? parseChallengeRule(row.definition) : undefined;
};

/**
 * Score one challenge and store its result.
 *
 * Only members who are *currently in the contest and still in the club* are
 * scored. Leaving either one ends the claim to a place in the result, which is
 * the same rule every other club read follows: a departure ends the
 * relationship rather than retaining a standing in it.
 */
export const finishClubChallenge = async (
  db: Database,
  challenge: DueChallengeRow
): Promise<boolean> => {
  const rule = await loadRule(db, challenge.rule_version);
  // A rule that can no longer be read is left for a human: the challenge stays
  // active rather than being finished with invented scores.
  if (!rule) return false;
  if (!rule.modes.includes(challenge.mode)) return false;

  const window = challengeWindow(asDateString(challenge.period_start), challenge.length_days);
  const participants = await db.query<{ account_id: string }>(
    `SELECT participant.account_id
     FROM club_challenge_participants participant
     JOIN club_memberships membership ON membership.account_id = participant.account_id
       AND membership.club_id = $2 AND membership.left_at IS NULL
     JOIN accounts account ON account.id = participant.account_id AND account.deleted_at IS NULL
     WHERE participant.challenge_id = $1 AND participant.left_at IS NULL
     ORDER BY participant.account_id`,
    [challenge.id, challenge.club_id]
  );

  const accountIds = participants.rows.map((row) => row.account_id);
  const activities = accountIds.length
    ? await db.query<ActivityRow>(
        `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
         FROM activity_submissions submission
         JOIN activity_validation_outputs output ON output.activity_id = submission.id
         WHERE submission.account_id = ANY($1::uuid[])
           AND submission.status = 'derived'
           AND submission.deleted_at IS NULL
           AND submission.processed_at >= $2
           AND submission.processed_at < $3
         ORDER BY submission.account_id, submission.processed_at`,
        [accountIds, window.periodStart, window.periodEnd]
      )
    : { rows: [] as ActivityRow[] };

  const byAccount = new Map<string, ScoredActivity[]>();
  for (const row of activities.rows) {
    const bucket = byAccount.get(row.account_id) ?? [];
    bucket.push({
      activeDurationSeconds: row.active_duration_seconds,
      endedAt: row.processed_at
    });
    byAccount.set(row.account_id, bucket);
  }

  const scored = accountIds
    .map((accountId) => ({
      accountId,
      score: challengeModeScore(
        challenge.mode,
        window,
        byAccount.get(accountId) ?? [],
        // No quest completion is recorded anywhere, which is why no rule
        // enables that mode and this list is never the scoring input.
        [],
        rule.dailyCapMinutes,
        rule.minMinutesPerActiveDay
      )
    }))
    .sort(
      (left, right) => right.score - left.score || left.accountId.localeCompare(right.accountId)
    );
  // Equal scores share a rank and the next rank skips. A tie is never broken on
  // pace, distance, or timing, none of which a result may read (ADR-0007).
  const ranks = competitionRanking(scored.map((entry) => entry.score));

  await withTransaction(db, async (client) => {
    const claimed = await client.query<{ id: string }>(
      `UPDATE club_challenges SET status = 'finished', finished_at = now()
       WHERE id = $1 AND status = 'active' RETURNING id`,
      [challenge.id]
    );
    // Another sweep got there first; its transaction owns the result rows.
    if (!claimed.rows[0]) return;
    for (const [index, entry] of scored.entries()) {
      await client.query(
        `INSERT INTO club_challenge_results (challenge_id, account_id, score, rank)
         VALUES ($1, $2, $3, $4) ON CONFLICT (challenge_id, account_id) DO NOTHING`,
        [challenge.id, entry.accountId, entry.score, ranks[index]!]
      );
    }
    // The 014 inbox trigger fans each row out to `notification.created`. The
    // body carries no score and no rank, so a push payload can never leak one,
    // and the kind is the existing `challenge_finished` so a member's
    // "challenges" notification preference governs it exactly as it already
    // does for a 1v1 result.
    for (const entry of scored) {
      await client.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
         VALUES ($1, 'challenge_finished', 'Club challenge finished',
           'Your club challenge is complete. Open it to see the standings.', $2)`,
        [entry.accountId, `runsphere://clubs/${challenge.club_id}/challenges/${challenge.id}`]
      );
    }
  });
  return true;
};

/**
 * Finish every challenge whose window has closed.
 *
 * A club that was archived is skipped: nobody can open it any more, so scoring
 * it would write a result no one can read. Those challenges stay active, which
 * is truthful — the contest never concluded.
 */
export const processClubChallenges = async (db: Database): Promise<number> => {
  const due = await db.query<DueChallengeRow>(
    `SELECT challenge.id, challenge.club_id, challenge.mode, challenge.length_days,
       challenge.period_start, challenge.rule_version
     FROM club_challenges challenge
     JOIN clubs club ON club.id = challenge.club_id
     WHERE challenge.status = 'active'
       AND club.archived_at IS NULL
       AND challenge.period_end <= (now() AT TIME ZONE 'Asia/Kolkata')::date
     ORDER BY challenge.period_end
     LIMIT 100`
  );

  let finished = 0;
  for (const challenge of due.rows) {
    if (await finishClubChallenge(db, challenge)) finished += 1;
  }
  return finished;
};
