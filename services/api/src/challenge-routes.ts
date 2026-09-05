import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ChallengeCreateRequestSchema,
  ChallengeListResponseSchema,
  ChallengeParamsSchema,
  ChallengeRespondRequestSchema,
  ChallengeResultSchema,
  ChallengeSummarySchema,
  ErrorResponseSchema,
  type ChallengeCreateRequest,
  type ChallengeListResponse,
  type ChallengeMode,
  type ChallengeParams,
  type ChallengeRespondRequest,
  type ChallengeResult,
  type ChallengeRole,
  type ChallengeSummary,
  type Profile
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  challengeLengthEnabled,
  challengeModeEnabled,
  kolkataDate,
  kolkataDayStart,
  parseChallengeRule,
  type ChallengeRule
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { requireSharingAllowed } from './sanction-guard.js';

/**
 * Asynchronous 1v1 friend challenges (ADR-0005, ADR-0007). A challenge needs a
 * mutual friendship, exposes only the opponent's `Profile`, and its result is
 * two pace-neutral integers. No route here reads or returns pace, speed,
 * distance, route geometry, or location.
 *
 * Scoring is never done here: the worker computes it from server-derived
 * activity once the window closes. `finished` therefore always has a stored
 * result, and a closed-but-unscored challenge answers `409` instead of
 * inventing a total.
 */
export interface ChallengeRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const INVITE_TTL_DAYS = 7;
const DEFAULT_COSMETIC: Profile['cosmetic'] = { avatarKey: 'default' };

interface ChallengeRow {
  id: string;
  mode: ChallengeMode;
  length_days: number;
  status: ChallengeSummary['status'];
  role: ChallengeRole;
  period_start: Date | string;
  period_end: Date | string;
  rule_version: string;
  created_at: Date;
  opponent_id: string;
  opponent_display_name: string | null;
  opponent_cosmetic: unknown;
  opponent_visibility: 'private' | 'followers';
}

const accountIdFrom = (request: FastifyRequest, secret: string): string | undefined => {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? verifyAccessToken(value.slice(7), secret) : undefined;
};

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const accountId = accountIdFrom(request, secret);
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

/** `date` columns come back as a Date in UTC; only the calendar date is meaningful. */
const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const loadActiveChallengeRule = async (
  database: Database
): Promise<{ version: number; rule: ChallengeRule } | undefined> => {
  const result = await database.query<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM rule_versions
     WHERE kind = 'challenge' AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  return row ? { version: row.version, rule: parseChallengeRule(row.definition) } : undefined;
};

/**
 * An account without a profile has no shareable identity, so the opponent is
 * presented by a neutral placeholder rather than an email or account id.
 */
const opponentProfile = (row: ChallengeRow): Profile => ({
  id: row.opponent_id,
  displayName: row.opponent_display_name ?? 'RunSphere member',
  cosmetic: (row.opponent_cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
  activityVisibility: row.opponent_visibility
});

const summaryFrom = (row: ChallengeRow): ChallengeSummary =>
  ({
    id: row.id,
    mode: row.mode,
    lengthDays: row.length_days,
    status: row.status,
    role: row.role,
    periodStart: asDateString(row.period_start),
    periodEnd: asDateString(row.period_end),
    opponent: opponentProfile(row),
    ruleVersion: row.rule_version,
    createdAt: row.created_at.toISOString()
  }) as ChallengeSummary;

/**
 * Selects one challenge as seen by `$1`, projecting the *other* participant as
 * the opponent whichever side invited.
 */
const CHALLENGE_SELECT = `
  SELECT challenge.id, challenge.mode, challenge.length_days, challenge.status,
         CASE WHEN challenge.challenger_account_id = $1 THEN 'challenger' ELSE 'opponent' END AS role,
         challenge.period_start, challenge.period_end, challenge.rule_version, challenge.created_at,
         opponent.id AS opponent_id, profile.display_name AS opponent_display_name,
         profile.cosmetic AS opponent_cosmetic, opponent.profile_visibility AS opponent_visibility
  FROM challenges challenge
  JOIN accounts opponent ON opponent.id = CASE
    WHEN challenge.challenger_account_id = $1 THEN challenge.opponent_account_id
    ELSE challenge.challenger_account_id END
  LEFT JOIN profiles profile ON profile.account_id = opponent.id
  WHERE (challenge.challenger_account_id = $1 OR challenge.opponent_account_id = $1)
    AND opponent.deleted_at IS NULL`;

export const registerChallengeRoutes = ({
  routes,
  database,
  authSecret
}: ChallengeRouteDeps): void => {
  routes.post<{ Body: ChallengeCreateRequest }>(
    '/v1/challenges',
    {
      schema: {
        tags: ['challenges'],
        headers: ActivityAuthorizationHeadersSchema,
        body: ChallengeCreateRequestSchema,
        response: {
          201: ChallengeSummarySchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      // Inviting somebody into a contest is putting yourself in front of
      // them, so a paused account cannot open one. Answering an invite it
      // already has is untouched.
      if (!(await requireSharingAllowed(database, reply, accountId))) return;

      const active = await loadActiveChallengeRule(database);
      if (!active) return reply.code(503).send({ message: 'Challenge rule unavailable' });
      // A mode the server cannot derive would score every pair 0-0, so it is
      // refused with a reason instead of silently producing a fabricated tie.
      if (!challengeModeEnabled(active.rule, request.body.mode))
        return reply
          .code(422)
          .send({ message: `Challenge mode '${request.body.mode}' is not available yet` });
      if (!challengeLengthEnabled(active.rule, request.body.lengthDays))
        return reply
          .code(422)
          .send({ message: `Challenge length ${request.body.lengthDays} days is not available` });

      // Mutual friendship is the authorization boundary; a block on either side
      // removes it. Both are checked in one statement so neither can be raced.
      const eligible = await database.query<{ friends: boolean; blocked: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM friendships forward
             WHERE forward.account_id = $1 AND forward.friend_account_id = $2)
           AND EXISTS (SELECT 1 FROM friendships back
             WHERE back.account_id = $2 AND back.friend_account_id = $1) AS friends,
           EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
             AND ((block.blocker_account_id = $1 AND block.blocked_account_id = $2)
               OR (block.blocker_account_id = $2 AND block.blocked_account_id = $1))) AS blocked
         FROM accounts friend WHERE friend.id = $2 AND friend.deleted_at IS NULL`,
        [accountId, request.body.friendAccountId]
      );
      const row = eligible.rows[0];
      if (!row || !row.friends || row.blocked)
        return reply.code(404).send({ message: 'Friend not found' });

      const now = new Date();
      const periodStart = kolkataDate(kolkataDayStart(now));
      const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

      const created = await database.query<{ id: string }>(
        `INSERT INTO challenges (
           mode, length_days, challenger_account_id, opponent_account_id, rule_version,
           period_start, period_end, invite_expires_at
         )
         SELECT $1, $2, $3, $4, $5, $6::date, $6::date + $2, $7
         WHERE NOT EXISTS (
           SELECT 1 FROM challenges open
           WHERE open.status IN ('invited', 'accepted', 'active')
             AND least(open.challenger_account_id, open.opponent_account_id)
               = least($3::uuid, $4::uuid)
             AND greatest(open.challenger_account_id, open.opponent_account_id)
               = greatest($3::uuid, $4::uuid)
         )
         RETURNING id`,
        [
          request.body.mode,
          request.body.lengthDays,
          accountId,
          request.body.friendAccountId,
          String(active.version),
          periodStart,
          inviteExpiresAt
        ]
      );
      if (!created.rows[0])
        return reply.code(409).send({ message: 'A challenge with this friend is already open' });

      await database.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
         VALUES ($1, 'challenge_invite', 'New challenge invite',
           'A friend invited you to a challenge.', $2)`,
        [request.body.friendAccountId, `runsphere://challenges/${created.rows[0].id}`]
      );

      const summary = await database.query<ChallengeRow>(
        `${CHALLENGE_SELECT} AND challenge.id = $2`,
        [accountId, created.rows[0].id]
      );
      if (!summary.rows[0]) return reply.code(404).send({ message: 'Challenge not found' });
      return reply.code(201).send(summaryFrom(summary.rows[0]));
    }
  );

  routes.get(
    '/v1/challenges',
    {
      schema: {
        tags: ['challenges'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ChallengeListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const result = await database.query<ChallengeRow>(
        `${CHALLENGE_SELECT} ORDER BY challenge.created_at DESC LIMIT 200`,
        [accountId]
      );
      const response: ChallengeListResponse = { data: result.rows.map(summaryFrom) };
      return response;
    }
  );

  routes.patch<{ Params: ChallengeParams; Body: ChallengeRespondRequest }>(
    '/v1/challenges/:challengeId',
    {
      schema: {
        tags: ['challenges'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ChallengeParamsSchema,
        body: ChallengeRespondRequestSchema,
        response: {
          200: ChallengeSummarySchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      // Only the invited account answers, and only while the invite is open.
      // Accepting restarts the window on the day of agreement so a slow reply
      // never costs the invitee scoring days.
      const responded = await withTransaction(database, async (client) => {
        const locked = await client.query<{ id: string; challenger_account_id: string }>(
          `SELECT id, challenger_account_id FROM challenges
           WHERE id = $1 AND opponent_account_id = $2 AND status = 'invited'
             AND invite_expires_at > now()
           FOR UPDATE`,
          [request.params.challengeId, accountId]
        );
        const challenge = locked.rows[0];
        if (!challenge) return undefined;
        if (!request.body.accept) {
          await client.query(
            `UPDATE challenges SET status = 'declined', responded_at = now() WHERE id = $1`,
            [challenge.id]
          );
          return { id: challenge.id, challengerAccountId: challenge.challenger_account_id };
        }
        await client.query(
          `UPDATE challenges SET status = 'active', responded_at = now(),
             period_start = $2::date, period_end = $2::date + length_days
           WHERE id = $1 AND status = 'invited'`,
          [challenge.id, kolkataDate(kolkataDayStart(new Date()))]
        );
        return { id: challenge.id, challengerAccountId: challenge.challenger_account_id };
      });
      if (!responded)
        return reply.code(409).send({ message: 'This challenge invite is no longer open' });

      await database.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
         VALUES ($1, 'challenge_invite', $2, $3, $4)`,
        [
          responded.challengerAccountId,
          request.body.accept ? 'Challenge accepted' : 'Challenge declined',
          request.body.accept
            ? 'Your friend accepted the challenge.'
            : 'Your friend declined the challenge.',
          `runsphere://challenges/${responded.id}`
        ]
      );

      const summary = await database.query<ChallengeRow>(
        `${CHALLENGE_SELECT} AND challenge.id = $2`,
        [accountId, responded.id]
      );
      if (!summary.rows[0]) return reply.code(404).send({ message: 'Challenge not found' });
      return summaryFrom(summary.rows[0]);
    }
  );

  routes.get<{ Params: ChallengeParams }>(
    '/v1/challenges/:challengeId/result',
    {
      schema: {
        tags: ['challenges'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ChallengeParamsSchema,
        response: {
          200: ChallengeResultSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const challenge = await database.query<{
        id: string;
        mode: ChallengeMode;
        period_start: Date | string;
        period_end: Date | string;
        status: ChallengeSummary['status'];
      }>(
        `SELECT id, mode, period_start, period_end, status FROM challenges
         WHERE id = $1 AND (challenger_account_id = $2 OR opponent_account_id = $2)`,
        [request.params.challengeId, accountId]
      );
      const row = challenge.rows[0];
      if (!row) return reply.code(404).send({ message: 'Challenge not found' });

      const stored = await database.query<{
        rule_version: string;
        winner_account_id: string | null;
      }>(`SELECT rule_version, winner_account_id FROM challenge_results WHERE challenge_id = $1`, [
        row.id
      ]);
      const result = stored.rows[0];
      // A window can close before the worker has scored it. Saying so is
      // truthful; presenting a zeroed or partial result would not be.
      if (!result) return reply.code(409).send({ message: 'This result is not ready yet' });

      const participants = await database.query<{ account_id: string; score: number }>(
        `SELECT account_id, score FROM challenge_participant_results
         WHERE challenge_id = $1 ORDER BY score DESC, account_id`,
        [row.id]
      );
      if (participants.rows.length !== 2)
        return reply.code(409).send({ message: 'This result is not ready yet' });

      const response: ChallengeResult = {
        id: row.id,
        mode: row.mode,
        periodStart: asDateString(row.period_start),
        periodEnd: asDateString(row.period_end),
        participants: participants.rows.map((participant) => ({
          accountId: participant.account_id,
          score: participant.score
        })) as ChallengeResult['participants'],
        ...(result.winner_account_id ? { winnerAccountId: result.winner_account_id } : {}),
        ruleVersion: result.rule_version
      };
      return response;
    }
  );
};
