import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  BlockCreateRequestSchema,
  BlockParamsSchema,
  BlockResponseSchema,
  ErrorResponseSchema,
  FriendListResponseSchema,
  FriendRequestCreateRequestSchema,
  FriendRequestCreateResponseSchema,
  FriendRequestListResponseSchema,
  FriendRequestParamsSchema,
  FriendRequestRespondRequestSchema,
  NotificationPreferencesSchema,
  NotificationPreferencesUpdateRequestSchema,
  ProfileResponseSchema,
  ProfileUpdateRequestSchema,
  InboxListResponseSchema,
  InboxMarkReadRequestSchema,
  type BlockCreateRequest,
  type FriendRequestCreateRequest,
  type FriendRequestRespondRequest,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
  type Profile,
  type ProfileUpdateRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { verifyAccessToken } from './auth.js';

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

const defaultNotificationPreferences = (): NotificationPreferences => ({
  categories: {
    friends: true,
    challenges: true,
    clubs: true,
    competitions: true,
    account: true,
    marketing: false
  },
  maxPerDay: 50,
  channels: { push: true, email: false }
});

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
      }>(
        `SELECT categories, quiet_hours, max_per_day, channels
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
        channels: row.channels as NotificationPreferences['channels']
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
      }>(
        `SELECT categories, quiet_hours, max_per_day, channels
         FROM notification_preferences WHERE account_id = $1`,
        [accountId]
      );
      const previous = existing.rows[0];
      const quietHours =
        'quietHours' in request.body
          ? request.body.quietHours
          : previous?.quiet_hours
            ? (previous.quiet_hours as NotificationPreferences['quietHours'])
            : undefined;
      const merged: NotificationPreferences = {
        categories:
          request.body.categories ??
          (previous?.categories as NotificationPreferences['categories']) ??
          defaultNotificationPreferences().categories,
        maxPerDay: request.body.maxPerDay ?? previous?.max_per_day ?? 50,
        channels:
          request.body.channels ??
          (previous?.channels as NotificationPreferences['channels']) ??
          defaultNotificationPreferences().channels
      };
      if (quietHours !== undefined) merged.quietHours = quietHours;
      const saved = await database.query<{
        categories: unknown;
        quiet_hours: unknown;
        max_per_day: number;
        channels: unknown;
      }>(
        `INSERT INTO notification_preferences (account_id, categories, quiet_hours, max_per_day, channels)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET
           categories = EXCLUDED.categories, quiet_hours = EXCLUDED.quiet_hours,
           max_per_day = EXCLUDED.max_per_day, channels = EXCLUDED.channels, updated_at = now()
         RETURNING categories, quiet_hours, max_per_day, channels`,
        [
          accountId,
          JSON.stringify(merged.categories),
          'quietHours' in merged && merged.quietHours ? JSON.stringify(merged.quietHours) : null,
          merged.maxPerDay,
          JSON.stringify(merged.channels)
        ]
      );
      await audit(database, accountId, 'notification_preferences.updated', 'account', accountId);
      const row = saved.rows[0]!;
      return {
        categories: row.categories as NotificationPreferences['categories'],
        ...(row.quiet_hours
          ? { quietHours: row.quiet_hours as NotificationPreferences['quietHours'] }
          : {}),
        maxPerDay: row.max_per_day,
        channels: row.channels as NotificationPreferences['channels']
      };
    }
  );
};
