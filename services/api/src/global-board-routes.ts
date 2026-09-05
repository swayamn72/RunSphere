import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  GlobalBoardParticipationRequestSchema,
  GlobalBoardResponseSchema,
  type GlobalBoardEntry,
  type GlobalBoardParticipationRequest,
  type GlobalBoardResponse,
  type Profile
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { verifyAccessToken } from './auth.js';
import { currentWeek } from './progression-core.js';
import { notSharingSuspended, requireSharingAllowed } from './sanction-guard.js';

/**
 * The opt-in global period board (Phase 3, milestone 3.5; ADR-0007).
 *
 * Reads are pure reads. The board is materialized by the worker, so this file
 * never scores anybody: it checks the reader's opt-in, takes one indexed page
 * of their division, and adds their own row. That is what keeps the widest
 * board in the product off the activity tables on every request.
 *
 * Nothing here selects location, route, pace, distance, activity timestamps,
 * or an email address. An entry is a `Profile`, a rank, and a score.
 */
export interface GlobalBoardRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const DEFAULT_COSMETIC: Profile['cosmetic'] = { avatarKey: 'default' };

const requireAccount = (
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string
): string | undefined => {
  const value = request.headers.authorization;
  const accountId = value?.startsWith('Bearer ')
    ? verifyAccessToken(value.slice(7), secret)
    : undefined;
  if (!accountId) void reply.code(401).send({ message: 'Unauthorized' });
  return accountId;
};

interface EntryRow {
  account_id: string;
  display_name: string | null;
  cosmetic: unknown;
  activity_visibility: 'private' | 'followers';
  rank: number;
  score: number;
}

const entryFrom = (row: EntryRow, accountId: string): GlobalBoardEntry => ({
  profile: {
    id: row.account_id,
    displayName: row.display_name ?? 'RunSphere member',
    cosmetic: (row.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
    activityVisibility: row.activity_visibility
  },
  rank: row.rank,
  cappedActiveMinutes: row.score,
  isSelf: row.account_id === accountId
});

export const registerGlobalBoardRoutes = ({
  routes,
  database,
  authSecret
}: GlobalBoardRouteDeps): void => {
  /**
   * This week's board, as one reader sees it.
   *
   * Three things bound what comes back. The reader must be on the board to
   * read it, which is the same reciprocity the friend and club boards use.
   * The page is their own division, because a division decides who you are
   * ranked *with* — a newcomer's first week is not measured against a
   * fiftieth. And a block hides two accounts from each other here as
   * everywhere else, which leaves a gap in the visible ranks rather than
   * renumbering them: the rank an account holds is a fact about the period,
   * not about who is looking.
   */
  routes.get(
    '/v1/boards/global',
    {
      schema: {
        tags: ['boards'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: GlobalBoardResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const { weekEnd, periodStart } = currentWeek(new Date());
      const period = { periodStart, periodEnd: weekEnd.toISOString().slice(0, 10) };

      const own = await database.query<{ participating: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM leaderboard_opt_ins optin
           WHERE optin.account_id = $1 AND optin.scope = 'global' AND optin.revoked_at IS NULL
         ) AS participating`,
        [accountId]
      );
      if (!own.rows[0]?.participating) {
        const response: GlobalBoardResponse = { ...period, participating: false, entries: [] };
        return response;
      }

      // The reader's own row decides which division's page to read. Until the
      // worker has ranked them there is no division to page, which is the
      // honest state for someone who has not moved yet this week.
      const mine = await database.query<{
        division: string;
        rank: number;
        score: number;
        rule_version: number;
      }>(
        `SELECT entry.division, entry.rank, entry.score, entry.rule_version
         FROM global_board_entries entry
         WHERE entry.period_start = $1::date AND entry.account_id = $2`,
        [periodStart, accountId]
      );
      const own_entry = mine.rows[0];
      if (!own_entry) {
        const response: GlobalBoardResponse = { ...period, participating: true, entries: [] };
        return response;
      }

      const page = await database.query<EntryRow>(
        `SELECT entry.account_id, entry.rank, entry.score, profile.display_name, profile.cosmetic,
           account.profile_visibility AS activity_visibility
         FROM global_board_entries entry
         JOIN accounts account ON account.id = entry.account_id AND account.deleted_at IS NULL
         LEFT JOIN profiles profile ON profile.account_id = entry.account_id
         WHERE entry.period_start = $1::date AND entry.division = $2
           AND ${notSharingSuspended('entry.account_id')}
           AND NOT EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
             AND ((block.blocker_account_id = $3 AND block.blocked_account_id = entry.account_id)
               OR (block.blocker_account_id = entry.account_id AND block.blocked_account_id = $3)))
         ORDER BY entry.rank, entry.account_id
         LIMIT 200`,
        [periodStart, own_entry.division, accountId]
      );

      const response: GlobalBoardResponse = {
        ...period,
        participating: true,
        division: own_entry.division,
        ruleVersion: own_entry.rule_version,
        // The reader's own standing, whether or not it fits on the page they
        // were handed. A rank and a score: they already know who they are.
        me: { rank: own_entry.rank, cappedActiveMinutes: own_entry.score },
        entries: page.rows.map((row) => entryFrom(row, accountId))
      };
      return response;
    }
  );

  /**
   * Join or leave the global board. Off by default and separately revocable
   * from every other scope (ADR-0007); leaving revokes rather than deletes, so
   * the opt-in history stays auditable and re-joining reopens the same row.
   *
   * Leaving does not wait for the worker to notice: the row is dropped from
   * the next recompute, and until then the reader's own read is already gated
   * on the live opt-in this route just changed.
   */
  routes.put<{ Body: GlobalBoardParticipationRequest }>(
    '/v1/boards/global/participation',
    {
      schema: {
        tags: ['boards'],
        headers: ActivityAuthorizationHeadersSchema,
        body: GlobalBoardParticipationRequestSchema,
        response: {
          200: GlobalBoardParticipationRequestSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      // Joining publishes this account to everyone else on the board, so a
      // paused account cannot; leaving is never guarded.
      if (request.body.participating && !(await requireSharingAllowed(database, reply, accountId)))
        return;
      if (request.body.participating) {
        await database.query(
          `INSERT INTO leaderboard_opt_ins (account_id, scope) VALUES ($1, 'global')
           ON CONFLICT (account_id, scope)
           DO UPDATE SET opted_in_at = now(), revoked_at = NULL`,
          [accountId]
        );
      } else {
        await database.query(
          `UPDATE leaderboard_opt_ins SET revoked_at = now()
           WHERE account_id = $1 AND scope = 'global' AND revoked_at IS NULL`,
          [accountId]
        );
        // Leaving takes the reader off the published board immediately rather
        // than at the next sweep. An opt-out that is still visible for hours
        // is not an opt-out.
        await database.query(
          'DELETE FROM global_board_entries WHERE account_id = $1 AND period_start >= $2::date',
          [accountId, currentWeek(new Date()).periodStart]
        );
      }
      await database.query(
        `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type,
           resource_id, metadata)
         VALUES ($1, $1, $2, 'account', $1, $3)`,
        [
          accountId,
          request.body.participating ? 'global_board.joined' : 'global_board.left',
          JSON.stringify({ scope: 'global' })
        ]
      );
      const response: GlobalBoardParticipationRequest = {
        participating: request.body.participating
      };
      return response;
    }
  );
};
