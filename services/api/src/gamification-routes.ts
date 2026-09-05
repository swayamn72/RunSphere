import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  BlockCreateRequestSchema,
  BlockListResponseSchema,
  BlockParamsSchema,
  BlockResponseSchema,
  ErrorResponseSchema,
  FriendListResponseSchema,
  FriendRequestCreateRequestSchema,
  FriendRequestCreateResponseSchema,
  FriendRequestListResponseSchema,
  FriendRequestParamsSchema,
  FriendRequestRespondRequestSchema,
  FriendStandingsParticipationRequestSchema,
  FriendStandingsResponseSchema,
  NotificationPreferencesSchema,
  NotificationPreferencesUpdateRequestSchema,
  ProfileResponseSchema,
  PushDeviceParamsSchema,
  PushDeviceRegisterRequestSchema,
  PushDeviceSchema,
  ProfileUpdateRequestSchema,
  InboxListResponseSchema,
  InboxMarkReadRequestSchema,
  type BlockCreateRequest,
  type FriendRequestCreateRequest,
  type FriendRequestRespondRequest,
  type FriendStandingEntry,
  type FriendStandingsParticipationRequest,
  type FriendStandingsResponse,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
  type Profile,
  type PushDeviceParams,
  type PushDeviceRegisterRequest,
  type ProfileUpdateRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  cappedWeeklyActiveMinutes,
  competitionRanking,
  defaultNotificationPreferences
} from '@runsphere/domain';
import { verifyAccessToken } from './auth.js';
import { currentWeek, loadActiveProgressionRule } from './progression-core.js';
import { notSharingSuspended, requireSharingAllowed } from './sanction-guard.js';

/**
 * Foundation-gate gameplay substrate: profiles, mutual friends/blocks, and the
 * durable notification inbox/preferences. Scoring stays in `@runsphere/domain`;
 * these routes only move and expose the already-versioned records.
 */
export interface GamificationRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

const DEFAULT_COSMETIC: Profile['cosmetic'] = { avatarKey: 'default' };

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
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<{ rows: unknown[] }> =>
  database.query(
    `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id, metadata)
     VALUES ($1, $1, $2, $3, $4, $5)`,
    [accountId, eventType, resourceType, resourceId ?? null, JSON.stringify(metadata)]
  );

// Friend-request creation is the one outward email-lookup surface; cap per
// authenticated requester so it cannot be used to enumerate addresses.
const friendRequestRateLimit = new Map<string, { attempts: number; resetAt: number }>();
const allowFriendRequest = (accountId: string): boolean => {
  const now = Date.now();
  const current = friendRequestRateLimit.get(accountId);
  if (!current || current.resetAt <= now) {
    friendRequestRateLimit.set(accountId, { attempts: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.attempts >= 20) return false;
  current.attempts += 1;
  return true;
};

const profileFromRow = (row: {
  id: string;
  display_name: string;
  cosmetic: unknown;
  activity_visibility: 'private' | 'followers';
}): Profile => ({
  id: row.id,
  displayName: row.display_name,
  cosmetic: (row.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
  activityVisibility: row.activity_visibility
});

export const registerGamificationRoutes = ({
  routes,
  database,
  authSecret
}: GamificationRouteDeps): void => {
  routes.get(
    '/v1/profile',
    {
      schema: {
        tags: ['profile'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: ProfileResponseSchema,
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
      const result = await database.query<{
        id: string;
        display_name: string;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
      }>(
        `SELECT profile.account_id AS id, profile.display_name, profile.cosmetic, account.profile_visibility AS activity_visibility
         FROM profiles profile JOIN accounts account ON account.id = profile.account_id
         WHERE profile.account_id = $1 AND account.deleted_at IS NULL`,
        [accountId]
      );
      const row = result.rows[0];
      if (!row) return reply.code(404).send({ message: 'Profile not found' });
      return profileFromRow(row);
    }
  );

  routes.put<{ Body: ProfileUpdateRequest }>(
    '/v1/profile',
    {
      schema: {
        tags: ['profile'],
        headers: ActivityAuthorizationHeadersSchema,
        body: ProfileUpdateRequestSchema,
        response: {
          200: ProfileResponseSchema,
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
      const account = await database.query<{ profile_visibility: 'private' | 'followers' }>(
        'SELECT profile_visibility FROM accounts WHERE id = $1 AND deleted_at IS NULL',
        [accountId]
      );
      if (!account.rows[0]) return reply.code(401).send({ message: 'Unauthorized' });

      const existing = await database.query<{ display_name: string; cosmetic: unknown }>(
        'SELECT display_name, cosmetic FROM profiles WHERE account_id = $1',
        [accountId]
      );
      const current = existing.rows[0];
      const displayName = request.body.displayName ?? current?.display_name;
      if (!displayName)
        return reply.code(400).send({ message: 'Display name is required to create a profile' });
      const cosmetic = current
        ? { ...(current.cosmetic as Profile['cosmetic']), ...request.body.cosmetic }
        : (request.body.cosmetic ?? DEFAULT_COSMETIC);

      const upserted = await database.query<{
        display_name: string;
        cosmetic: unknown;
      }>(
        `INSERT INTO profiles (account_id, display_name, cosmetic) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name,
           cosmetic = EXCLUDED.cosmetic, updated_at = now()
         RETURNING display_name, cosmetic`,
        [accountId, displayName, JSON.stringify(cosmetic)]
      );
      await audit(database, accountId, 'profile.updated', 'profile', accountId);
      return {
        id: accountId,
        displayName: upserted.rows[0]!.display_name,
        cosmetic: upserted.rows[0]!.cosmetic as Profile['cosmetic'],
        activityVisibility: account.rows[0].profile_visibility
      };
    }
  );

  routes.post<{ Body: FriendRequestCreateRequest }>(
    '/v1/friends/requests',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        body: FriendRequestCreateRequestSchema,
        response: {
          202: FriendRequestCreateResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          429: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      if (!allowFriendRequest(accountId))
        return reply.code(429).send({ message: 'Too many requests' });
      // Checked before the address is looked at, so the refusal is about the
      // sender's own account and discloses nothing about the recipient. A
      // paused account can still *receive* requests and accept them: what is
      // paused is putting yourself in front of other people.
      if (!(await requireSharingAllowed(database, reply, accountId))) return;
      const email = request.body.email.trim().toLowerCase();

      const target = await database.query<{ id: string; skip: boolean }>(
        `SELECT target.id,
           (target.id = $1
             OR EXISTS (SELECT 1 FROM friendships friend WHERE friend.account_id = $1 AND friend.friend_account_id = target.id)
             OR EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
               AND ((block.blocker_account_id = $1 AND block.blocked_account_id = target.id)
                 OR (block.blocker_account_id = target.id AND block.blocked_account_id = $1)))
             OR EXISTS (SELECT 1 FROM friend_requests request WHERE request.status = 'pending'
               AND ((request.requester_account_id = $1 AND request.addressee_account_id = target.id)
                 OR (request.requester_account_id = target.id AND request.addressee_account_id = $1)))) AS skip
         FROM accounts target WHERE lower(target.email) = lower($2) AND target.deleted_at IS NULL`,
        [accountId, email]
      );
      // Deliberately generic: never reveal whether the address exists (ADR-0007,
      // feedback note). The response is identical for "no account" and "recorded".
      if (!target.rows[0] || target.rows[0].skip)
        return reply.code(202).send({ status: 'recorded' });

      const created = await database.query<{ id: string }>(
        `INSERT INTO friend_requests (requester_account_id, addressee_account_id) VALUES ($1, $2) RETURNING id`,
        [accountId, target.rows[0].id]
      );
      await database.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body)
         VALUES ($1, 'friend_request', 'New friend request', 'Someone sent you a friend request.')`,
        [target.rows[0].id]
      );
      await audit(
        database,
        accountId,
        'friend_request.created',
        'friend_request',
        created.rows[0]!.id
      );
      return reply.code(202).send({ status: 'recorded' });
    }
  );

  routes.get(
    '/v1/friends/requests',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: FriendRequestListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const rows = await database.query<{
        id: string;
        account_id: string;
        display_name: string;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
        created_at: Date;
        responded_at: Date | null;
      }>(
        `SELECT request.id, request.requester_account_id AS account_id, profile.display_name,
           profile.cosmetic, account.profile_visibility AS activity_visibility,
           request.created_at, request.responded_at
         FROM friend_requests request
         JOIN profiles profile ON profile.account_id = request.requester_account_id
         JOIN accounts account ON account.id = profile.account_id
         WHERE request.addressee_account_id = $1 AND request.status = 'pending'
           AND account.deleted_at IS NULL
         ORDER BY request.created_at DESC`,
        [accountId]
      );
      return {
        data: rows.rows.map((row) => ({
          id: row.id,
          accountId: row.account_id,
          counterpartProfile: profileFromRow({
            id: row.account_id,
            display_name: row.display_name,
            cosmetic: row.cosmetic,
            activity_visibility: row.activity_visibility
          }),
          status: 'pending' as const,
          createdAt: row.created_at.toISOString(),
          ...(row.responded_at ? { respondedAt: row.responded_at.toISOString() } : {})
        }))
      };
    }
  );

  routes.post<{ Params: { requestId: string }; Body: FriendRequestRespondRequest }>(
    '/v1/friends/requests/:requestId/respond',
    {
      schema: {
        tags: ['friends'],
        params: FriendRequestParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        body: FriendRequestRespondRequestSchema,
        response: {
          204: { type: 'null' },
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
      const status = request.body.accept ? 'accepted' : 'declined';
      const responded = await database.query<{ requester_account_id: string }>(
        `UPDATE friend_requests SET status = $3, responded_at = now()
         WHERE id = $1 AND addressee_account_id = $2 AND status = 'pending'
         RETURNING requester_account_id`,
        [request.params.requestId, accountId, status]
      );
      const requester = responded.rows[0]?.requester_account_id;
      if (!requester) return reply.code(404).send({ message: 'Friend request not found' });
      if (request.body.accept) {
        await database.query(
          `INSERT INTO friendships (account_id, friend_account_id) VALUES ($1, $2), ($2, $1)
           ON CONFLICT DO NOTHING`,
          [accountId, requester]
        );
      }
      await audit(
        database,
        accountId,
        `friend_request.${status}`,
        'friend_request',
        request.params.requestId
      );
      return reply.code(204).send();
    }
  );

  routes.get(
    '/v1/friends',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: FriendListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const rows = await database.query<{
        id: string;
        display_name: string;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
      }>(
        `SELECT profile.account_id AS id, profile.display_name, profile.cosmetic,
           account.profile_visibility AS activity_visibility
         FROM friendships friend
         JOIN profiles profile ON profile.account_id = friend.friend_account_id
         JOIN accounts account ON account.id = profile.account_id
         WHERE friend.account_id = $1 AND account.deleted_at IS NULL
         ORDER BY profile.display_name`,
        [accountId]
      );
      return { data: rows.rows.map(profileFromRow) };
    }
  );

  /**
   * Live blocks for the caller. Blocking removes the friendship and revokes
   * pending requests in both directions, so a blocked account vanishes from
   * every other surface; this list is the only place it can be found again,
   * which is what makes the block reversible from the client.
   */
  routes.get(
    '/v1/blocks',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: BlockListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const rows = await database.query<{
        id: string;
        display_name: string | null;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
        created_at: Date;
      }>(
        `SELECT account.id, profile.display_name, profile.cosmetic,
           account.profile_visibility AS activity_visibility, block.created_at
         FROM blocks block
         JOIN accounts account ON account.id = block.blocked_account_id
         LEFT JOIN profiles profile ON profile.account_id = account.id
         WHERE block.blocker_account_id = $1 AND block.revoked_at IS NULL
           AND account.deleted_at IS NULL
         ORDER BY block.created_at DESC`,
        [accountId]
      );
      return {
        data: rows.rows.map((row) => ({
          profile: profileFromRow({
            id: row.id,
            // An account that never set a display name still has to be
            // identifiable enough to unblock.
            display_name: row.display_name ?? 'RunSphere member',
            cosmetic: row.cosmetic,
            activity_visibility: row.activity_visibility
          }),
          blockedAt: row.created_at.toISOString()
        }))
      };
    }
  );

  routes.post<{ Body: BlockCreateRequest }>(
    '/v1/blocks',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        body: BlockCreateRequestSchema,
        response: {
          200: BlockResponseSchema,
          400: ErrorResponseSchema,
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
      const targetId = request.body.accountId;
      if (targetId === accountId)
        return reply.code(400).send({ message: 'Cannot block your own account' });
      const target = await database.query<{ id: string }>(
        'SELECT id FROM accounts WHERE id = $1 AND deleted_at IS NULL',
        [targetId]
      );
      if (!target.rows[0]) return reply.code(404).send({ message: 'Account not found' });

      await database.query(
        `INSERT INTO blocks (blocker_account_id, blocked_account_id, reason) VALUES ($1, $2, $3)
         ON CONFLICT (blocker_account_id, blocked_account_id)
         DO UPDATE SET reason = COALESCE(blocks.reason, EXCLUDED.reason), revoked_at = NULL`,
        [accountId, targetId, request.body.reason ?? null]
      );
      await database.query(
        `DELETE FROM friendships WHERE (account_id = $1 AND friend_account_id = $2)
           OR (account_id = $2 AND friend_account_id = $1)`,
        [accountId, targetId]
      );
      await database.query(
        `UPDATE friend_requests SET status = 'revoked', responded_at = now()
         WHERE status = 'pending'
           AND ((requester_account_id = $1 AND addressee_account_id = $2)
             OR (requester_account_id = $2 AND addressee_account_id = $1))`,
        [accountId, targetId]
      );
      await audit(database, accountId, 'block.created', 'block', targetId);
      return { accountId: targetId, status: 'blocked' as const };
    }
  );

  routes.delete<{ Params: { accountId: string } }>(
    '/v1/blocks/:accountId',
    {
      schema: {
        tags: ['friends'],
        params: BlockParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: BlockResponseSchema,
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
      const revoked = await database.query<{ id: string }>(
        `UPDATE blocks SET revoked_at = now()
         WHERE blocker_account_id = $1 AND blocked_account_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [accountId, request.params.accountId]
      );
      if (!revoked.rows[0]) return reply.code(404).send({ message: 'Block not found' });
      await audit(database, accountId, 'block.revoked', 'block', request.params.accountId);
      return { accountId: request.params.accountId, status: 'unblocked' as const };
    }
  );

  routes.get(
    '/v1/notifications',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: InboxListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const rows = await database.query<{
        id: string;
        kind: string;
        title: string;
        body: string;
        deep_link: string | null;
        read_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, kind, title, body, deep_link, read_at, created_at
         FROM notification_inbox WHERE account_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [accountId]
      );
      return {
        data: rows.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          ...(row.deep_link ? { deepLink: row.deep_link } : {}),
          ...(row.read_at ? { readAt: row.read_at.toISOString() } : {}),
          createdAt: row.created_at.toISOString()
        }))
      };
    }
  );

  routes.post<{ Body: { ids: string[] } }>(
    '/v1/notifications/read',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        body: InboxMarkReadRequestSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      await database.query(
        `UPDATE notification_inbox SET read_at = coalesce(read_at, now())
         WHERE account_id = $1 AND id = ANY($2::uuid[])`,
        [accountId, request.body.ids]
      );
      return reply.code(204).send();
    }
  );

  routes.get(
    '/v1/notifications/preferences',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: NotificationPreferencesSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const result = await database.query<{
        categories: unknown;
        quiet_hours: unknown;
        max_per_day: number;
        channels: unknown;
        marketing_consent: boolean;
      }>(
        `SELECT categories, quiet_hours, max_per_day, channels, marketing_consent
         FROM notification_preferences WHERE account_id = $1`,
        [accountId]
      );
      const row = result.rows[0];
      if (!row) return defaultNotificationPreferences();
      return {
        categories: row.categories as NotificationPreferences['categories'],
        ...(row.quiet_hours
          ? { quietHours: row.quiet_hours as NotificationPreferences['quietHours'] }
          : {}),
        maxPerDay: row.max_per_day,
        channels: row.channels as NotificationPreferences['channels'],
        marketingConsent: row.marketing_consent
      };
    }
  );

  routes.put<{ Body: NotificationPreferencesUpdateRequest }>(
    '/v1/notifications/preferences',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        body: NotificationPreferencesUpdateRequestSchema,
        response: {
          200: NotificationPreferencesSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const existing = await database.query<{
        categories: unknown;
        quiet_hours: unknown;
        max_per_day: number;
        channels: unknown;
        marketing_consent: boolean;
      }>(
        `SELECT categories, quiet_hours, max_per_day, channels, marketing_consent
         FROM notification_preferences WHERE account_id = $1`,
        [accountId]
      );
      const previous = existing.rows[0];
      // An explicit `null` clears the window; an absent key keeps the stored
      // one. Without the null case quiet hours could never be switched off.
      const quietHours =
        'quietHours' in request.body
          ? (request.body.quietHours ?? undefined)
          : ((previous?.quiet_hours as NotificationPreferences['quietHours']) ?? undefined);
      const merged: NotificationPreferences = {
        categories:
          request.body.categories ??
          (previous?.categories as NotificationPreferences['categories']) ??
          defaultNotificationPreferences().categories,
        maxPerDay: request.body.maxPerDay ?? previous?.max_per_day ?? 50,
        channels:
          request.body.channels ??
          (previous?.channels as NotificationPreferences['channels']) ??
          defaultNotificationPreferences().channels,
        marketingConsent:
          request.body.marketingConsent ??
          previous?.marketing_consent ??
          defaultNotificationPreferences().marketingConsent
      };
      if (quietHours) merged.quietHours = quietHours;
      const saved = await database.query<{
        categories: unknown;
        quiet_hours: unknown;
        max_per_day: number;
        channels: unknown;
        marketing_consent: boolean;
      }>(
        `INSERT INTO notification_preferences (account_id, categories, quiet_hours, max_per_day, channels, marketing_consent)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6)
         ON CONFLICT (account_id) DO UPDATE SET
           categories = EXCLUDED.categories, quiet_hours = EXCLUDED.quiet_hours,
           max_per_day = EXCLUDED.max_per_day, channels = EXCLUDED.channels,
           marketing_consent = EXCLUDED.marketing_consent, updated_at = now()
         RETURNING categories, quiet_hours, max_per_day, channels, marketing_consent`,
        [
          accountId,
          JSON.stringify(merged.categories),
          merged.quietHours ? JSON.stringify(merged.quietHours) : null,
          merged.maxPerDay,
          JSON.stringify(merged.channels),
          merged.marketingConsent
        ]
      );
      await audit(database, accountId, 'notification_preferences.updated', 'account', accountId);
      // Campaign consent is consent, so a change to it is recorded where every
      // other consent decision is recorded — not only as a column that was
      // overwritten (milestone 3.9).
      if (previous === undefined || previous.marketing_consent !== merged.marketingConsent)
        await database.query(
          `INSERT INTO consent_history (account_id, consent_type, granted, policy_version)
           VALUES ($1, 'marketing_email', $2, 'preferences')`,
          [accountId, merged.marketingConsent]
        );
      const row = saved.rows[0]!;
      return {
        categories: row.categories as NotificationPreferences['categories'],
        ...(row.quiet_hours
          ? { quietHours: row.quiet_hours as NotificationPreferences['quietHours'] }
          : {}),
        maxPerDay: row.max_per_day,
        channels: row.channels as NotificationPreferences['channels'],
        marketingConsent: row.marketing_consent
      };
    }
  );

  /**
   * Push registration (ADR-0009). A registration is a delivery address, not a
   * preference: whether a push is actually sent stays with
   * `/v1/notifications/preferences` and the worker's decision function, so
   * registering never re-enables a channel the account turned off.
   *
   * The token is hashed in the database, matching the other token paths, and
   * the upsert moves a token that reappears on a different account rather than
   * fanning a push out to the device's previous owner.
   */
  routes.post<{ Body: PushDeviceRegisterRequest }>(
    '/v1/notifications/devices',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        body: PushDeviceRegisterRequestSchema,
        response: {
          201: PushDeviceSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const saved = await database.query<{
        id: string;
        platform: 'android';
        created_at: Date;
        last_seen_at: Date;
      }>(
        `INSERT INTO push_devices (account_id, platform, token, token_hash)
         VALUES ($1, $2, $3, encode(digest($3, 'sha256'), 'hex'))
         ON CONFLICT (token_hash) WHERE revoked_at IS NULL DO UPDATE SET
           account_id = EXCLUDED.account_id, platform = EXCLUDED.platform,
           token = EXCLUDED.token, last_seen_at = now()
         RETURNING id, platform, created_at, last_seen_at`,
        [accountId, request.body.platform, request.body.token]
      );
      const row = saved.rows[0]!;
      await audit(database, accountId, 'push_device.registered', 'account', row.id, {
        platform: row.platform
      });
      return reply.code(201).send({
        id: row.id,
        platform: row.platform,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString()
      });
    }
  );

  /**
   * Revoking is scoped to the caller's own registrations and answers 204 even
   * when nothing matched, so the route cannot be used to probe whether a device
   * id exists on another account.
   */
  routes.delete<{ Params: PushDeviceParams }>(
    '/v1/notifications/devices/:deviceId',
    {
      schema: {
        tags: ['notifications'],
        headers: ActivityAuthorizationHeadersSchema,
        params: PushDeviceParamsSchema,
        response: {
          204: { type: 'null' },
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const revoked = await database.query<{ id: string }>(
        `UPDATE push_devices SET revoked_at = now(), revoke_reason = 'signed_out'
         WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [request.params.deviceId, accountId]
      );
      if (revoked.rows[0])
        await audit(database, accountId, 'push_device.revoked', 'account', revoked.rows[0].id);
      return reply.code(204).send();
    }
  );

  /**
   * Weekly friend board (ADR-0007). Mutual friendship is the authorization
   * boundary, participation is a separate opt-in from activity visibility, and
   * an entry carries exactly one published pace-neutral score. Location,
   * route, activity timestamps, pace, and distance are never selected here.
   *
   * The score is the same capped weekly active-minute total the account sees on
   * its own Home consistency card, computed by `@runsphere/domain` from the
   * published progression rule so the two can never disagree.
   */
  routes.get(
    '/v1/friends/standings',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: FriendStandingsResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;

      const { weekStart, weekEnd, periodStart } = currentWeek(new Date());
      const period = { periodStart, periodEnd: weekEnd.toISOString().slice(0, 10) };

      const own = await database.query<{ participating: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM leaderboard_opt_ins optin
           WHERE optin.account_id = $1 AND optin.scope = 'friends' AND optin.revoked_at IS NULL
         ) AS participating`,
        [accountId]
      );
      const participating = Boolean(own.rows[0]?.participating);
      // Reading other people's scores requires being on the board yourself.
      if (!participating) {
        const response: FriendStandingsResponse = { ...period, participating: false, entries: [] };
        return response;
      }

      const rule = await loadActiveProgressionRule(database);
      if (!rule) {
        const response: FriendStandingsResponse = { ...period, participating: true, entries: [] };
        return response;
      }

      // Mutual friendship plus a live opt-in on both sides, minus any block in
      // either direction. The account itself is included once it has opted in.
      const members = await database.query<{
        account_id: string;
        display_name: string | null;
        cosmetic: unknown;
        activity_visibility: 'private' | 'followers';
      }>(
        `WITH mutual AS (
           SELECT forward.friend_account_id AS account_id
           FROM friendships forward
           WHERE forward.account_id = $1
             AND EXISTS (SELECT 1 FROM friendships back
               WHERE back.account_id = forward.friend_account_id
                 AND back.friend_account_id = $1)
             AND NOT EXISTS (SELECT 1 FROM blocks block WHERE block.revoked_at IS NULL
               AND ((block.blocker_account_id = $1
                     AND block.blocked_account_id = forward.friend_account_id)
                 OR (block.blocker_account_id = forward.friend_account_id
                     AND block.blocked_account_id = $1)))
           UNION
           SELECT $1::uuid
         )
         SELECT account.id AS account_id, profile.display_name, profile.cosmetic,
                account.profile_visibility AS activity_visibility
         FROM mutual
         JOIN accounts account ON account.id = mutual.account_id AND account.deleted_at IS NULL
         JOIN leaderboard_opt_ins optin ON optin.account_id = mutual.account_id
           AND optin.scope = 'friends' AND optin.revoked_at IS NULL
           AND ${notSharingSuspended('mutual.account_id')}
         LEFT JOIN profiles profile ON profile.account_id = mutual.account_id
         LIMIT 200`,
        [accountId]
      );
      if (!members.rows.length) {
        const response: FriendStandingsResponse = {
          ...period,
          participating: true,
          ruleVersion: String(rule.version),
          entries: []
        };
        return response;
      }

      const activities = await database.query<{
        account_id: string;
        active_duration_seconds: number;
        processed_at: Date;
      }>(
        `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
         FROM activity_submissions submission
         JOIN activity_validation_outputs output ON output.activity_id = submission.id
         WHERE submission.account_id = ANY($1::uuid[])
           AND submission.status = 'derived'
           AND submission.deleted_at IS NULL
           AND submission.processed_at >= $2
           AND submission.processed_at < $3`,
        [members.rows.map((member) => member.account_id), weekStart, weekEnd]
      );
      const byAccount = new Map<string, { activeDurationSeconds: number; endedAt: Date }[]>();
      for (const row of activities.rows) {
        const bucket = byAccount.get(row.account_id) ?? [];
        bucket.push({
          activeDurationSeconds: row.active_duration_seconds,
          endedAt: row.processed_at
        });
        byAccount.set(row.account_id, bucket);
      }

      const scored = members.rows
        .map((member) => ({
          member,
          score: cappedWeeklyActiveMinutes(
            byAccount.get(member.account_id) ?? [],
            weekStart,
            rule.rule.dailyCapMinutes
          )
        }))
        // Equal scores are ordered by display name so the list is stable; the
        // shared rank below is what the reader is actually shown.
        .sort(
          (left, right) =>
            right.score - left.score ||
            (left.member.display_name ?? '').localeCompare(right.member.display_name ?? '') ||
            left.member.account_id.localeCompare(right.member.account_id)
        );
      const ranks = competitionRanking(scored.map((entry) => entry.score));

      const entries: FriendStandingEntry[] = scored.map((entry, index) => ({
        profile: {
          id: entry.member.account_id,
          displayName: entry.member.display_name ?? 'RunSphere member',
          cosmetic: (entry.member.cosmetic as Profile['cosmetic']) ?? DEFAULT_COSMETIC,
          activityVisibility: entry.member.activity_visibility
        },
        rank: ranks[index]!,
        cappedActiveMinutes: entry.score,
        isSelf: entry.member.account_id === accountId
      }));
      const response: FriendStandingsResponse = {
        ...period,
        participating: true,
        ruleVersion: String(rule.version),
        entries
      };
      return response;
    }
  );

  /**
   * Join or leave the friend board. Leaving revokes rather than deletes, so the
   * opt-in history stays auditable, and re-joining reopens the same row.
   */
  routes.put<{ Body: FriendStandingsParticipationRequest }>(
    '/v1/friends/standings/participation',
    {
      schema: {
        tags: ['friends'],
        headers: ActivityAuthorizationHeadersSchema,
        body: FriendStandingsParticipationRequestSchema,
        response: {
          200: FriendStandingsParticipationRequestSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      // Joining publishes this account to mutual friends, so a paused account
      // cannot; leaving is never guarded.
      if (request.body.participating && !(await requireSharingAllowed(database, reply, accountId)))
        return;
      if (request.body.participating) {
        await database.query(
          `INSERT INTO leaderboard_opt_ins (account_id, scope) VALUES ($1, 'friends')
           ON CONFLICT (account_id, scope)
           DO UPDATE SET opted_in_at = now(), revoked_at = NULL`,
          [accountId]
        );
      } else {
        await database.query(
          `UPDATE leaderboard_opt_ins SET revoked_at = now()
           WHERE account_id = $1 AND scope = 'friends' AND revoked_at IS NULL`,
          [accountId]
        );
      }
      await audit(
        database,
        accountId,
        request.body.participating ? 'friend_standings.joined' : 'friend_standings.left',
        'account',
        accountId
      );
      const response: FriendStandingsParticipationRequest = {
        participating: request.body.participating
      };
      return response;
    }
  );
};
