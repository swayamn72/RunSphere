import type { FastifyReply } from 'fastify';
import type { Database } from '@runsphere/db';
import {
  SHARING_SUSPENDED_KINDS,
  restrictionsFor,
  type AccountRestrictions,
  type SanctionKind
} from '@runsphere/domain';

/**
 * Sanction enforcement (Phase 3, milestone 3.8).
 *
 * 3.7 recorded sanctions and told the account about them; nothing acted on
 * them. This module is the one place that does, so "what a suspension actually
 * stops" has a single answer that the routes, the worker, and the tests all
 * read.
 *
 * Two shapes of enforcement, deliberately kept apart:
 *
 * - **Your own actions**: `requireSharingAllowed` refuses the acts that publish
 *   you to other people, and answers with the statement staff wrote, so a
 *   refusal is never mysterious.
 * - **Other people's views**: `notSharingSuspended` is a SQL fragment that
 *   drops a suspended account from somebody else's board or standings. A
 *   suspension that only stopped *new* participation would leave the account on
 *   every board it had already joined, which is not a pause of anything.
 *
 * A suspension never touches recording, history, export, or club membership: a
 * paused account is still a member of its clubs and still owns its own data.
 */

const SHARING_KIND_LIST = SHARING_SUSPENDED_KINDS.map((kind) => `'${kind}'`).join(', ');

/**
 * SQL for "this account is not currently under a sharing suspension".
 *
 * The argument is a column reference from the surrounding query, always a
 * literal written in our own source — never request input — because it is
 * interpolated rather than bound.
 */
export const notSharingSuspended = (accountColumn: string): string =>
  `NOT EXISTS (SELECT 1 FROM sanctions suspension
     WHERE suspension.account_id = ${accountColumn}
       AND suspension.kind IN (${SHARING_KIND_LIST})
       AND suspension.revoked_at IS NULL
       AND (suspension.expires_at IS NULL OR suspension.expires_at > now()))`;

interface SanctionStateRow {
  kind: SanctionKind;
  statement: string;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Every sanction on one account, reduced to what it may not do. One query, so
 * a route pays a single round trip to know.
 */
export const loadRestrictions = async (
  database: Database,
  accountId: string,
  now: Date = new Date()
): Promise<AccountRestrictions> => {
  const result = await database.query<SanctionStateRow>(
    `SELECT kind, statement, expires_at, revoked_at FROM sanctions
     WHERE account_id = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [accountId]
  );
  return restrictionsFor(
    result.rows.map((row) => ({
      kind: row.kind,
      statement: row.statement,
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined
    })),
    now
  );
};

/**
 * Guard for an act that publishes this account to other people: joining a
 * board, entering a contest, creating or joining a club, sending a friend
 * request.
 *
 * Returns `true` when the act may proceed. On a refusal it has already sent a
 * `403` carrying the statement staff wrote, because being told *why* — in the
 * words of the decision — is the difference between moderation and a wall.
 *
 * Leaving, withdrawing, and revoking are never guarded: an account may always
 * remove itself from something, sanction or no sanction.
 */
export const requireSharingAllowed = async (
  database: Database,
  reply: FastifyReply,
  accountId: string
): Promise<boolean> => {
  const restrictions = await loadRestrictions(database, accountId);
  if (!restrictions.sharingPaused) return true;
  await reply.code(403).send({
    message:
      restrictions.statement ??
      'Sharing is paused on your account. Open your account settings to read the decision.'
  });
  return false;
};
