import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ClubCreateRequestSchema,
  ClubJoinRequestSchema,
  ClubListResponseSchema,
  ClubMemberParamsSchema,
  ClubMemberRoleUpdateRequestSchema,
  ClubMemberSchema,
  ClubMembersResponseSchema,
  ClubParamsSchema,
  ClubRelayCreateRequestSchema,
  ClubRelayListResponseSchema,
  ClubRelaySummarySchema,
  ClubSchema,
  ErrorResponseSchema,
  type Club,
  type ClubCreateRequest,
  type ClubJoinRequest,
  type ClubMember,
  type ClubMemberParams,
  type ClubMemberRoleUpdateRequest,
  type ClubParams,
  type ClubRelayCreateRequest,
  type ClubRelaySummary,
  type ClubRole,
  type Profile
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  canArchive,
  canChangeRole,
  canLeave,
  canManageRelay,
  canRemoveMember,
  isPlausibleInviteCode,
  normalizeInviteCode,
  parseClubRelayRule,
  relayGoalMet,
  relayProgressPercent,
  relayTargetAllowed,
  visibleToMember,
  type ClubRelayRule
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { currentWeek } from './progression-core.js';

/**
 * Clubs (Phase 3, milestone 3.1).
 *
 * A club is private and invite-code-only: there is no public club list or
 * search, so every read here starts from the caller's own active membership.
 * A non-member is answered `404` for a club that exists, because a `403` would
 * confirm the club id — and an invite code is the whole access path.
 *
 * Authority is decided by the pure predicates in `@runsphere/domain`, so the
 * route never invents a rule the tests do not also see. Nothing in this file
 * reads or returns location, route, pace, activity detail, or an email address;
 * a member is exposed as a `Profile` and nothing more.
 */
export interface ClubRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const DEFAULT_COSMETIC: Profile['cosmetic'] = { avatarKey: 'default' };
const INVITE_CODE_ATTEMPTS = 5;

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

const audit = (
  database: Database,
  accountId: string,
  eventType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id, metadata)
     VALUES ($1, $1, $2, 'club', $3, $4)`,
    [accountId, eventType, resourceId, JSON.stringify(metadata)]
  );

const generateInviteCode = (): string =>
  Array.from(
    { length: INVITE_CODE_LENGTH },
    () => INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]
  ).join('');

interface ClubRow {
  id: string;
  name: string;
  invite_code: string;
  archived_at: Date | null;
  role: ClubRole;
  member_count: string;
}

const clubFromRow = (row: ClubRow): Club => ({
  id: row.id,
  name: row.name,
  role: row.role,
  memberCount: Number(row.member_count),
  inviteCode: row.invite_code,
  ...(row.archived_at ? { archivedAt: row.archived_at.toISOString() } : {})
});

/**
 * One club as the caller may see it. The member count is the club's real live
 * size; a roster is filtered per reader elsewhere, but the size of a club is a
 * fact about the club rather than about a person.
 */
const CLUB_SELECT = `
  SELECT club.id, club.name, club.invite_code, club.archived_at, membership.role,
    (SELECT count(*) FROM club_memberships live
      WHERE live.club_id = club.id AND live.left_at IS NULL)::text AS member_count
  FROM clubs club
  JOIN club_memberships membership ON membership.club_id = club.id
  WHERE membership.account_id = $1 AND membership.left_at IS NULL`;

/**
 * The single authorization gate. Returns the caller's live role in a live
 * club, or `undefined` — which every route turns into a `404`, so club
 * existence is never confirmed to someone outside it.
 */
const activeRole = async (
  database: Database,
  clubId: string,
  accountId: string
): Promise<ClubRole | undefined> => {
  const result = await database.query<{ role: ClubRole }>(
    `SELECT membership.role FROM club_memberships membership
     JOIN clubs club ON club.id = membership.club_id
     WHERE membership.club_id = $1 AND membership.account_id = $2
       AND membership.left_at IS NULL AND club.archived_at IS NULL`,
    [clubId, accountId]
  );
  return result.rows[0]?.role;
};

const liveMemberCount = async (database: Database, clubId: string): Promise<number> => {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM club_memberships
     WHERE club_id = $1 AND left_at IS NULL`,
    [clubId]
  );
  return Number(result.rows[0]?.count ?? 0);
};

/**
 * The published club-relay rule. Absent means relays are not enabled on this
 * deployment, which the routes report rather than inventing a default target.
 */
const loadActiveClubRule = async (
  database: Database
): Promise<{ version: number; rule: ClubRelayRule } | undefined> => {
  const result = await database.query<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM rule_versions
     WHERE kind = 'club' AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { version: row.version, rule: parseClubRelayRule(row.definition) };
};

interface RelayTotals {
  totalUnits: number;
  contributorCount: number;
  myUnits: number;
}

/** Aggregates for one relay, plus the reader's own units. Never a breakdown. */
const relayTotals = async (
  database: Database,
  relayId: string,
  accountId: string
): Promise<RelayTotals> => {
  const result = await database.query<{
    total_units: string;
    contributor_count: string;
    my_units: string;
  }>(
    `SELECT coalesce(sum(units), 0)::text AS total_units,
       count(*) FILTER (WHERE units > 0)::text AS contributor_count,
       coalesce(sum(units) FILTER (WHERE account_id = $2), 0)::text AS my_units
     FROM club_relay_contributions WHERE relay_id = $1`,
    [relayId, accountId]
  );
  const row = result.rows[0];
  return {
    totalUnits: Number(row?.total_units ?? 0),
    contributorCount: Number(row?.contributor_count ?? 0),
    myUnits: Number(row?.my_units ?? 0)
  };
};

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const relaySummary = (
  row: {
    id: string;
    period_start: Date | string;
    period_end: Date | string;
    target_units: number;
    rule_version: number;
  },
  totals: RelayTotals,
  openWeekStart: string
): ClubRelaySummary => {
  const periodStart = asDateString(row.period_start);
  return {
    id: row.id,
    periodStart,
    periodEnd: asDateString(row.period_end),
    targetUnits: row.target_units,
    totalUnits: totals.totalUnits,
    myUnits: totals.myUnits,
    contributorCount: totals.contributorCount,
    progressPercent: relayProgressPercent(totals.totalUnits, row.target_units),
    goalMet: relayGoalMet(totals.totalUnits, row.target_units),
    current: periodStart === openWeekStart,
    ruleVersion: row.rule_version
  };
};

export const registerClubRoutes = ({ routes, database, authSecret }: ClubRouteDeps): void => {
  /**
   * Creating a club makes the creator its owner in the same transaction, so a
   * club can never exist without the authority to moderate or archive it.
   */
  routes.post<{ Body: ClubCreateRequest }>(
    '/v1/clubs',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        body: ClubCreateRequestSchema,
        response: {
          201: ClubSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const name = request.body.name.trim().replace(/\s+/g, ' ');
      if (!name) return reply.code(400).send({ message: 'A club needs a name' });

      const created = await withTransaction(database, async (client) => {
        // A code collision is astronomically unlikely but cheap to retry, and
        // a failed insert here would otherwise lose the whole club.
        for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
          const inviteCode = generateInviteCode();
          const club = await client.query<{ id: string; invite_code: string }>(
            `INSERT INTO clubs (name, invite_code, created_by_account_id)
             VALUES ($1, $2, $3) ON CONFLICT (invite_code) DO NOTHING
             RETURNING id, invite_code`,
            [name, inviteCode, accountId]
          );
          const row = club.rows[0];
          if (!row) continue;
          await client.query(
            `INSERT INTO club_memberships (club_id, account_id, role) VALUES ($1, $2, 'owner')`,
            [row.id, accountId]
          );
          return row;
        }
        return undefined;
      });
      if (!created) return reply.code(503).send({ message: 'Service unavailable' });

      await audit(database, accountId, 'club.created', created.id);
      return reply.code(201).send({
        id: created.id,
        name,
        role: 'owner' as const,
        memberCount: 1,
        inviteCode: created.invite_code
      });
    }
  );

  /** Live clubs the caller is an active member of. Never a public listing. */
  routes.get(
    '/v1/clubs',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ClubListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const rows = await database.query<ClubRow>(
        `${CLUB_SELECT} AND club.archived_at IS NULL ORDER BY club.name LIMIT 100`,
        [accountId]
      );
      return { data: rows.rows.map(clubFromRow) };
    }
  );

  /**
   * Joining is by exact code only. An unknown code, a badly formed code, and
   * an archived club are all `404`: distinguishing them would turn this route
   * into an oracle for guessing codes.
   */
  routes.post<{ Body: ClubJoinRequest }>(
    '/v1/clubs/join',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        body: ClubJoinRequestSchema,
        response: {
          200: ClubSchema,
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
      const inviteCode = normalizeInviteCode(request.body.inviteCode);
      if (!isPlausibleInviteCode(inviteCode))
        return reply.code(404).send({ message: 'Club not found' });

      const joined = await withTransaction(database, async (client) => {
        const club = await client.query<{ id: string; name: string; invite_code: string }>(
          `SELECT id, name, invite_code FROM clubs
           WHERE invite_code = $1 AND archived_at IS NULL FOR UPDATE`,
          [inviteCode]
        );
        const row = club.rows[0];
        if (!row) return { status: 'missing' as const };
        // A previous departure is reactivated rather than duplicated. Being
        // removed is not a ban — bans are moderation work that does not exist
        // yet — so a removed account may rejoin with the code.
        const membership = await client.query<{ role: ClubRole }>(
          `INSERT INTO club_memberships (club_id, account_id, role) VALUES ($1, $2, 'member')
           ON CONFLICT (club_id, account_id) DO UPDATE SET
             left_at = NULL, left_reason = NULL, removed_by_account_id = NULL,
             joined_at = now(), role = CASE WHEN club_memberships.left_at IS NULL
               THEN club_memberships.role ELSE 'member' END
           WHERE club_memberships.left_at IS NOT NULL
           RETURNING role`,
          [row.id, accountId]
        );
        if (!membership.rows[0]) return { status: 'already' as const };
        return { status: 'joined' as const, club: row, role: membership.rows[0].role };
      });
      if (joined.status === 'missing') return reply.code(404).send({ message: 'Club not found' });
      if (joined.status === 'already')
        return reply.code(409).send({ message: 'Already a member of this club' });

      await audit(database, accountId, 'club.joined', joined.club.id);
      return {
        id: joined.club.id,
        name: joined.club.name,
        role: joined.role,
        memberCount: await liveMemberCount(database, joined.club.id),
        inviteCode: joined.club.invite_code
      };
    }
  );

  /**
   * The roster. Membership is the authorization boundary, and a block hides two
   * accounts from each other here as everywhere else — the count above still
   * reports the club's real size.
   */
  routes.get<{ Params: ClubParams }>(
    '/v1/clubs/:clubId/members',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubParamsSchema,
        response: {
          200: ClubMembersResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!(await activeRole(database, request.params.clubId, accountId)))
        return reply.code(404).send({ message: 'Club not found' });

      const rows = await database.query<{
        account_id: string;
        display_name: string | null;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
        role: ClubRole;
        joined_at: Date;
        blocked_either_way: boolean;
      }>(
        `SELECT membership.account_id, profile.display_name, profile.cosmetic,
           account.profile_visibility AS activity_visibility, membership.role, membership.joined_at,
           EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
             AND ((block.blocker_account_id = $2 AND block.blocked_account_id = membership.account_id)
               OR (block.blocker_account_id = membership.account_id AND block.blocked_account_id = $2)))
             AS blocked_either_way
         FROM club_memberships membership
         JOIN accounts account ON account.id = membership.account_id
         LEFT JOIN profiles profile ON profile.account_id = membership.account_id
         WHERE membership.club_id = $1 AND membership.left_at IS NULL
           AND account.deleted_at IS NULL
         ORDER BY membership.role, membership.joined_at
         LIMIT 500`,
        [request.params.clubId, accountId]
      );

      return {
        data: rows.rows
          .filter((row) =>
            visibleToMember({
              blockedEitherWay: row.blocked_either_way,
              self: row.account_id === accountId
            })
          )
          .map((row) => ({
            profile: {
              id: row.account_id,
              displayName: row.display_name ?? 'RunSphere member',
              cosmetic: (row.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
              activityVisibility: row.activity_visibility
            },
            role: row.role,
            joinedAt: row.joined_at.toISOString()
          }))
      };
    }
  );

  /**
   * Leaving. The owner is held until they are the last member: a club with
   * members and no owner has nobody who can appoint an admin or archive it,
   * and silent succession would hand a stranger moderation powers.
   */
  routes.delete<{ Params: ClubParams }>(
    '/v1/clubs/:clubId/membership',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubParamsSchema,
        response: {
          204: { type: 'null' },
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
      const role = await activeRole(database, request.params.clubId, accountId);
      if (!role) return reply.code(404).send({ message: 'Club not found' });
      if (!canLeave(role, await liveMemberCount(database, request.params.clubId)))
        return reply
          .code(409)
          .send({ message: 'Hand the club to someone else or archive it before leaving' });

      await database.query(
        `UPDATE club_memberships SET left_at = now(), left_reason = 'left'
         WHERE club_id = $1 AND account_id = $2 AND left_at IS NULL`,
        [request.params.clubId, accountId]
      );
      await audit(database, accountId, 'club.left', request.params.clubId);
      return reply.code(204).send();
    }
  );

  /** Removal needs strictly greater authority, so no one removes an equal. */
  routes.delete<{ Params: ClubMemberParams }>(
    '/v1/clubs/:clubId/members/:accountId',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubMemberParamsSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const { clubId, accountId: targetId } = request.params;
      const role = await activeRole(database, clubId, accountId);
      if (!role) return reply.code(404).send({ message: 'Club not found' });
      const targetRole = await activeRole(database, clubId, targetId);
      if (!targetRole) return reply.code(404).send({ message: 'Member not found' });
      if (!canRemoveMember(role, targetRole, { self: targetId === accountId }))
        return reply.code(403).send({ message: 'Not allowed to remove this member' });

      await database.query(
        `UPDATE club_memberships SET left_at = now(), left_reason = 'removed',
           removed_by_account_id = $3
         WHERE club_id = $1 AND account_id = $2 AND left_at IS NULL`,
        [clubId, targetId, accountId]
      );
      await audit(database, accountId, 'club.member_removed', clubId, { role: targetRole });
      return reply.code(204).send();
    }
  );

  /** Granting or withdrawing `admin`, which is the owner's alone. */
  routes.patch<{ Params: ClubMemberParams; Body: ClubMemberRoleUpdateRequest }>(
    '/v1/clubs/:clubId/members/:accountId',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubMemberParamsSchema,
        body: ClubMemberRoleUpdateRequestSchema,
        response: {
          200: ClubMemberSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const { clubId, accountId: targetId } = request.params;
      const role = await activeRole(database, clubId, accountId);
      if (!role) return reply.code(404).send({ message: 'Club not found' });
      const targetRole = await activeRole(database, clubId, targetId);
      if (!targetRole) return reply.code(404).send({ message: 'Member not found' });
      if (!canChangeRole(role, targetRole, { self: targetId === accountId }))
        return reply.code(403).send({ message: 'Not allowed to change this role' });

      const updated = await database.query<{
        role: ClubRole;
        joined_at: Date;
        display_name: string | null;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
      }>(
        `UPDATE club_memberships membership SET role = $3
         WHERE membership.club_id = $1 AND membership.account_id = $2 AND membership.left_at IS NULL
         RETURNING membership.role, membership.joined_at,
           (SELECT display_name FROM profiles WHERE account_id = $2) AS display_name,
           (SELECT cosmetic FROM profiles WHERE account_id = $2) AS cosmetic,
           (SELECT profile_visibility FROM accounts WHERE id = $2) AS activity_visibility`,
        [clubId, targetId, request.body.role]
      );
      const row = updated.rows[0];
      if (!row) return reply.code(404).send({ message: 'Member not found' });
      await audit(database, accountId, 'club.role_changed', clubId, { role: request.body.role });
      const member: ClubMember = {
        profile: {
          id: targetId,
          displayName: row.display_name ?? 'RunSphere member',
          cosmetic: (row.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
          activityVisibility: row.activity_visibility
        },
        role: row.role,
        joinedAt: row.joined_at.toISOString()
      };
      return member;
    }
  );

  /**
   * Set this club's target for the open week. The week is not a parameter, so
   * a target can never be attached to a week that has already been scored, and
   * `UNIQUE (club_id, period_start)` means a second call updates the target
   * rather than creating a rival relay.
   *
   * The totals are not computed here: the worker recomputes them from
   * server-derived activity, so a freshly created relay honestly reads zero
   * until it runs.
   */
  routes.post<{ Params: ClubParams; Body: ClubRelayCreateRequest }>(
    '/v1/clubs/:clubId/relays',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubParamsSchema,
        body: ClubRelayCreateRequestSchema,
        response: {
          200: ClubRelaySummarySchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          422: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const role = await activeRole(database, request.params.clubId, accountId);
      if (!role) return reply.code(404).send({ message: 'Club not found' });
      if (!canManageRelay(role))
        return reply.code(403).send({ message: 'Only a club owner or admin can set the relay' });

      const published = await loadActiveClubRule(database);
      // A `422` rather than a `400`: the target is well-formed, the published
      // rule simply does not allow it — or there is no published rule at all.
      if (!published) return reply.code(422).send({ message: 'No club relay rule is published' });
      if (!relayTargetAllowed(published.rule, request.body.targetUnits))
        return reply.code(422).send({
          message: `A relay target must be between ${published.rule.minTargetUnits} and ${published.rule.maxTargetUnits} minutes`
        });

      const week = currentWeek(new Date());
      const saved = await database.query<{
        id: string;
        period_start: Date | string;
        period_end: Date | string;
        target_units: number;
        rule_version: number;
      }>(
        `INSERT INTO club_relays (club_id, period_start, period_end, target_units, rule_version,
           created_by_account_id)
         VALUES ($1, $2::date, $2::date + 7, $3, $4, $5)
         ON CONFLICT (club_id, period_start) DO UPDATE SET
           target_units = EXCLUDED.target_units, rule_version = EXCLUDED.rule_version
         RETURNING id, period_start, period_end, target_units, rule_version`,
        [
          request.params.clubId,
          week.periodStart,
          request.body.targetUnits,
          published.version,
          accountId
        ]
      );
      const row = saved.rows[0]!;
      await audit(database, accountId, 'club.relay_set', request.params.clubId, {
        targetUnits: row.target_units
      });
      const totals = await relayTotals(database, row.id, accountId);
      return relaySummary(row, totals, week.periodStart);
    }
  );

  /**
   * The club's relay weeks, newest first. Every number here is an aggregate
   * plus the reader's own contribution: there is no per-member breakdown to
   * ask for, because a club receives aggregate completion data only.
   */
  routes.get<{ Params: ClubParams }>(
    '/v1/clubs/:clubId/relays',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubParamsSchema,
        response: {
          200: ClubRelayListResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!(await activeRole(database, request.params.clubId, accountId)))
        return reply.code(404).send({ message: 'Club not found' });

      const relays = await database.query<{
        id: string;
        period_start: Date | string;
        period_end: Date | string;
        target_units: number;
        rule_version: number;
        total_units: string;
        contributor_count: string;
        my_units: string;
      }>(
        `SELECT relay.id, relay.period_start, relay.period_end, relay.target_units,
           relay.rule_version,
           coalesce(sum(contribution.units), 0)::text AS total_units,
           count(contribution.account_id) FILTER (WHERE contribution.units > 0)::text
             AS contributor_count,
           coalesce(sum(contribution.units) FILTER (WHERE contribution.account_id = $2), 0)::text
             AS my_units
         FROM club_relays relay
         LEFT JOIN club_relay_contributions contribution ON contribution.relay_id = relay.id
         WHERE relay.club_id = $1
         GROUP BY relay.id
         ORDER BY relay.period_start DESC
         LIMIT 52`,
        [request.params.clubId, accountId]
      );
      const openWeek = currentWeek(new Date()).periodStart;
      return {
        data: relays.rows.map((row) =>
          relaySummary(
            row,
            {
              totalUnits: Number(row.total_units),
              contributorCount: Number(row.contributor_count),
              myUnits: Number(row.my_units)
            },
            openWeek
          )
        )
      };
    }
  );

  /**
   * Archiving ends access for everyone at once while the membership rows stay
   * as the audited record of who was in the club. It is not a delete.
   */
  routes.post<{ Params: ClubParams }>(
    '/v1/clubs/:clubId/archive',
    {
      schema: {
        tags: ['clubs'],
        headers: ActivityAuthorizationHeadersSchema,
        params: ClubParamsSchema,
        response: {
          200: ClubSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const role = await activeRole(database, request.params.clubId, accountId);
      if (!role) return reply.code(404).send({ message: 'Club not found' });
      if (!canArchive(role))
        return reply.code(403).send({ message: 'Only the club owner can archive it' });

      const archived = await database.query<{
        id: string;
        name: string;
        invite_code: string;
        archived_at: Date;
        member_count: string;
      }>(
        `UPDATE clubs SET archived_at = now()
         WHERE id = $1 AND archived_at IS NULL
         RETURNING id, name, invite_code, archived_at,
           (SELECT count(*) FROM club_memberships live
             WHERE live.club_id = clubs.id AND live.left_at IS NULL)::text AS member_count`,
        [request.params.clubId]
      );
      const row = archived.rows[0];
      if (!row) return reply.code(404).send({ message: 'Club not found' });
      await audit(database, accountId, 'club.archived', row.id);
      return {
        id: row.id,
        name: row.name,
        role,
        memberCount: Number(row.member_count),
        inviteCode: row.invite_code,
        archivedAt: row.archived_at.toISOString()
      };
    }
  );
};
