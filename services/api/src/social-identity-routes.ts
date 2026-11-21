import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  IdentityResponseSchema,
  IdentityUpdateSchema,
  PrivacySettingsSchema,
  PrivacySettingsUpdateSchema,
  ProfileSearchQuerySchema,
  ProfileSearchResponseSchema,
  PublicProfileSchema,
  UsernameAvailabilitySchema,
  UsernameParamsSchema,
  type IdentityUpdate,
  type PrivacySettings,
  type PrivacySettingsUpdate,
  type PublicProfile
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import {
  isHomeArea,
  normalizeUsername,
  usernameProblem,
  USERNAME_PROBLEM_MESSAGE
} from '@runsphere/domain';
import { audit, requireAccount } from './auth-routes.js';

/**
 * Social identity and privacy controls (ADR-0014).
 *
 * Every rule about who may see whom is applied here, in SQL, before anything
 * leaves the server; the app only renders what it is given. An account with
 * no `privacy_settings` row (created by a script or before migration 050)
 * reads as the conservative defaults: Friends-only and not searchable.
 */
export interface SocialIdentityRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

interface SettingsRow {
  profile_visibility: PrivacySettings['profileVisibility'];
  searchable: boolean;
  friend_requests_from: PrivacySettings['friendRequestsFrom'];
  runs_visibility: PrivacySettings['runsVisibility'];
  show_route_maps: boolean;
  show_start_times: boolean;
  name_on_ground: boolean;
  draw_ground: boolean;
  friend_board: boolean;
  ghost_races: boolean;
  reviewed_at: Date | null;
}

const settingsFrom = (row: SettingsRow): PrivacySettings => ({
  profileVisibility: row.profile_visibility,
  searchable: row.searchable,
  friendRequestsFrom: row.friend_requests_from,
  runsVisibility: row.runs_visibility,
  showRouteMaps: row.show_route_maps,
  showStartTimes: row.show_start_times,
  nameOnGround: row.name_on_ground,
  drawGround: row.draw_ground,
  friendBoard: row.friend_board,
  ghostRaces: row.ghost_races,
  reviewed: row.reviewed_at !== null
});

const COLUMN: Readonly<Record<keyof PrivacySettingsUpdate, string>> = {
  profileVisibility: 'profile_visibility',
  searchable: 'searchable',
  friendRequestsFrom: 'friend_requests_from',
  runsVisibility: 'runs_visibility',
  showRouteMaps: 'show_route_maps',
  showStartTimes: 'show_start_times',
  nameOnGround: 'name_on_ground',
  drawGround: 'draw_ground',
  friendBoard: 'friend_board',
  ghostRaces: 'ghost_races'
};

/**
 * One runner as `$1` (the reader) may see them. Each `target` row comes with
 * the reader's relationship, whether a block stands between them either way,
 * and whether the target's settings let the reader see or request them.
 */
const PROFILE_SELECT = `
  SELECT target.id, target.username, target.home_area,
    COALESCE(profile.display_name, target.username) AS display_name,
    COALESCE(profile.cosmetic, '{"avatarKey":"default"}'::jsonb) AS cosmetic,
    COALESCE(settings.profile_visibility, 'friends') AS profile_visibility,
    COALESCE(settings.searchable, false) AS searchable,
    COALESCE(settings.friend_requests_from, 'everyone') AS friend_requests_from,
    CASE
      WHEN target.id = $1 THEN 'self'
      WHEN EXISTS (SELECT 1 FROM friendships f WHERE f.account_id = $1 AND f.friend_account_id = target.id)
        THEN 'friend'
      WHEN EXISTS (SELECT 1 FROM friend_requests r WHERE r.status = 'pending'
        AND r.requester_account_id = $1 AND r.addressee_account_id = target.id) THEN 'request_sent'
      WHEN EXISTS (SELECT 1 FROM friend_requests r WHERE r.status = 'pending'
        AND r.requester_account_id = target.id AND r.addressee_account_id = $1) THEN 'request_received'
      ELSE 'none'
    END AS relationship,
    EXISTS (SELECT 1 FROM blocks b WHERE b.revoked_at IS NULL
      AND ((b.blocker_account_id = $1 AND b.blocked_account_id = target.id)
        OR (b.blocker_account_id = target.id AND b.blocked_account_id = $1))) AS blocked,
    EXISTS (SELECT 1 FROM friendships mine
      JOIN friendships theirs ON theirs.account_id = target.id
        AND theirs.friend_account_id = mine.friend_account_id
      WHERE mine.account_id = $1) AS mutual_friend
  FROM accounts target
  LEFT JOIN profiles profile ON profile.account_id = target.id
  LEFT JOIN privacy_settings settings ON settings.account_id = target.id
  WHERE target.deleted_at IS NULL`;

interface ProfileRow {
  id: string;
  username: string;
  home_area: string | null;
  display_name: string;
  cosmetic: { avatarKey?: string; tier?: string };
  profile_visibility: PrivacySettings['profileVisibility'];
  searchable: boolean;
  friend_requests_from: PrivacySettings['friendRequestsFrom'];
  relationship: PublicProfile['relationship'];
  blocked: boolean;
  mutual_friend: boolean;
}

/** Whether the reader may see this profile at all. */
export const canSeeProfile = (row: ProfileRow): boolean => {
  if (row.relationship === 'self') return true;
  if (row.blocked) return false;
  if (row.profile_visibility === 'everyone') return true;
  if (row.profile_visibility === 'friends') return row.relationship === 'friend';
  return false;
};

const canRequest = (row: ProfileRow): boolean => {
  if (row.relationship !== 'none' || row.blocked) return false;
  if (row.friend_requests_from === 'everyone') return true;
  if (row.friend_requests_from === 'friends_of_friends') return row.mutual_friend;
  return false;
};

const publicProfile = (row: ProfileRow): PublicProfile => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  cosmetic: {
    avatarKey: row.cosmetic.avatarKey ?? 'default',
    ...(row.cosmetic.tier ? { tier: row.cosmetic.tier } : {})
  },
  ...(row.home_area ? { homeArea: row.home_area } : {}),
  relationship: row.relationship,
  canSendRequest: canRequest(row)
});

/** `%` and `_` typed into search are literal characters, not wildcards. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

export const registerSocialIdentityRoutes = ({
  routes,
  database,
  authSecret
}: SocialIdentityRouteDeps): void => {
  /**
   * Open to signed-out callers because sign-up asks before an account exists.
   * Usernames are public by design, so this reveals nothing a profile link
   * wouldn't; the general rate limit bounds enumeration.
   */
  routes.get<{ Params: { username: string } }>(
    '/v1/usernames/:username/availability',
    {
      schema: {
        params: UsernameParamsSchema,
        response: { 200: UsernameAvailabilitySchema, 503: ErrorResponseSchema }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const username = normalizeUsername(request.params.username);
      const problem = usernameProblem(username);
      if (problem) return { username, available: false, reason: USERNAME_PROBLEM_MESSAGE[problem] };
      const taken = await database.query(
        'SELECT 1 FROM accounts WHERE lower(username) = lower($1)',
        [username]
      );
      return taken.rows[0]
        ? { username, available: false, reason: 'That username is taken. Try another.' }
        : { username, available: true };
    }
  );

  routes.get(
    '/v1/account/identity',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: IdentityResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const row = await database.query<{
        username: string;
        home_area: string | null;
        has_dob: boolean;
      }>(
        `SELECT username, home_area, birth_date IS NOT NULL AS has_dob
         FROM accounts WHERE id = $1 AND deleted_at IS NULL`,
        [accountId]
      );
      const account = row.rows[0];
      if (!account) return reply.code(401).send({ message: 'Unauthorized' });
      return {
        username: account.username,
        ...(account.home_area ? { homeArea: account.home_area } : {}),
        hasDateOfBirth: account.has_dob
      };
    }
  );

  routes.put<{ Body: IdentityUpdate }>(
    '/v1/account/identity',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: IdentityUpdateSchema,
        response: {
          200: IdentityResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const { homeArea } = request.body;
      const username =
        request.body.username === undefined ? undefined : normalizeUsername(request.body.username);
      if (username !== undefined) {
        const problem = usernameProblem(username);
        if (problem) return reply.code(400).send({ message: USERNAME_PROBLEM_MESSAGE[problem] });
      }
      if (typeof homeArea === 'string' && !isHomeArea(homeArea))
        return reply.code(400).send({ message: 'Pick your area from the list.' });
      try {
        const updated = await database.query<{
          username: string;
          home_area: string | null;
          has_dob: boolean;
        }>(
          `UPDATE accounts SET
             username = COALESCE($2, username),
             home_area = CASE WHEN $3 THEN $4 ELSE home_area END,
             updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING username, home_area, birth_date IS NOT NULL AS has_dob`,
          [accountId, username ?? null, homeArea !== undefined, homeArea ?? null]
        );
        const account = updated.rows[0];
        if (!account) return reply.code(401).send({ message: 'Unauthorized' });
        await audit(database, accountId, 'account.identity_updated', 'account', accountId);
        return {
          username: account.username,
          ...(account.home_area ? { homeArea: account.home_area } : {}),
          hasDateOfBirth: account.has_dob
        };
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        if (failure.code === '23505' && failure.constraint === 'accounts_username_unique')
          return reply.code(409).send({ message: 'That username is taken. Try another.' });
        throw error;
      }
    }
  );

  routes.get(
    '/v1/privacy-settings',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: { 200: PrivacySettingsSchema, 401: ErrorResponseSchema, 503: ErrorResponseSchema }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      // A missing row is created with the conservative defaults, the same ones
      // migration 050 gave existing accounts.
      const row = await database.query<SettingsRow>(
        `INSERT INTO privacy_settings (account_id, profile_visibility, searchable, name_on_ground)
         VALUES ($1, 'friends', false, false)
         ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
         RETURNING *`,
        [accountId]
      );
      return settingsFrom(row.rows[0]!);
    }
  );

  routes.put<{ Body: PrivacySettingsUpdate }>(
    '/v1/privacy-settings',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: PrivacySettingsUpdateSchema,
        response: { 200: PrivacySettingsSchema, 401: ErrorResponseSchema, 503: ErrorResponseSchema }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const entries = (Object.keys(COLUMN) as (keyof PrivacySettingsUpdate)[]).filter(
        (key) => request.body[key] !== undefined
      );
      // Column names come from the fixed map above, never from the request.
      const assignments = entries.map((key, index) => `${COLUMN[key]} = $${index + 2}`);
      await database.query(
        `INSERT INTO privacy_settings (account_id, profile_visibility, searchable, name_on_ground)
         VALUES ($1, 'friends', false, false)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId]
      );
      const row = await database.query<SettingsRow>(
        `UPDATE privacy_settings SET
           ${[...assignments, 'reviewed_at = now()', 'updated_at = now()'].join(', ')}
         WHERE account_id = $1
         RETURNING *`,
        [accountId, ...entries.map((key) => request.body[key])]
      );
      await audit(database, accountId, 'privacy_settings.updated', 'account', accountId);
      return settingsFrom(row.rows[0]!);
    }
  );

  routes.get<{ Querystring: { q: string } }>(
    '/v1/profiles/search',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        querystring: ProfileSearchQuerySchema,
        response: {
          200: ProfileSearchResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const query = normalizeUsername(request.query.q);
      if (query.length < 2) return { data: [] };
      const rows = await database.query<ProfileRow>(
        `${PROFILE_SELECT}
           AND target.id <> $1
           AND lower(target.username) LIKE $2 ESCAPE '\\'
         ORDER BY (lower(target.username) = $3) DESC, target.username
         LIMIT 60`,
        [accountId, `${escapeLike(query)}%`, query]
      );
      // Searchable runners whose profile the reader may see. Filtered after
      // the query so the visibility rule lives in one place (`canSeeProfile`).
      const data = rows.rows
        .filter((row) => row.searchable && canSeeProfile(row))
        .slice(0, 20)
        .map(publicProfile);
      return { data };
    }
  );

  routes.get<{ Params: { username: string } }>(
    '/v1/profiles/by-username/:username',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        params: UsernameParamsSchema,
        response: {
          200: PublicProfileSchema,
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
      const rows = await database.query<ProfileRow>(
        `${PROFILE_SELECT} AND lower(target.username) = lower($2)`,
        [accountId, normalizeUsername(request.params.username)]
      );
      const row = rows.rows[0];
      // Hidden and missing read the same, so a private runner can't be confirmed.
      if (!row || !canSeeProfile(row)) return reply.code(404).send({ message: 'Runner not found' });
      return publicProfile(row);
    }
  );
};
