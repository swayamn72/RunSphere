import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  ErrorResponseSchema,
  PrivacyZoneRequestSchema,
  PrivacyZoneResponseSchema,
  SafetyContactAcceptResponseSchema,
  SafetyContactListResponseSchema,
  SafetyContactParamsSchema,
  SafetyContactRequestSchema,
  SafetyContactResponseSchema,
  SafetyShareParamsSchema,
  SafetyShareReadResponseSchema,
  SafetyShareRequestSchema,
  SafetyShareResponseSchema,
  SafetyShareUpdateRequestSchema,
  VisibilityRequestSchema,
  VisibilityResponseSchema,
  type PrivacyZoneRequest,
  type SafetyContactRequest,
  type SafetyShareRequest,
  type SafetyShareUpdateRequest,
  type VisibilityRequest
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { audit, requireAccount } from './auth-routes.js';

const privacyZoneRadiusMeters = 200;
const safetyShareDelayMinutes = 15;
const safetyShareTileSizeMeters = 500;

export const coarseTile = (latitude: number, longitude: number) => ({
  // Equirectangular tiles deliberately avoid H3 and retain no precise source coordinate.
  x: Math.floor(
    (longitude * 111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01)) /
      safetyShareTileSizeMeters
  ),
  y: Math.floor((latitude * 110_574) / safetyShareTileSizeMeters)
});

export interface SafetyRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

export const registerSafetyRoutes = ({ routes, database, authSecret }: SafetyRouteDeps) => {
  routes.post<{ Body: PrivacyZoneRequest }>(
    '/v1/privacy-zones',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: PrivacyZoneRequestSchema,
        response: {
          201: PrivacyZoneResponseSchema,
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
      const { latitude, longitude } = request.body.center;
      const result = await database.query<{ id: string; geometry_version: number }>(
        `INSERT INTO privacy_zones (account_id, name, center, radius_meters, geometry)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5,
           ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $6::double precision)::geometry)
         RETURNING id, geometry_version`,
        [
          accountId,
          request.body.name,
          longitude,
          latitude,
          privacyZoneRadiusMeters,
          privacyZoneRadiusMeters
        ]
      );
      await audit(
        database,
        accountId,
        'privacy_zone.created',
        'privacy_zone',
        result.rows[0]!.id
      );
      return reply.code(201).send({
        id: result.rows[0]!.id,
        name: request.body.name,
        center: request.body.center,
        radiusMeters: privacyZoneRadiusMeters,
        geometryVersion: result.rows[0]!.geometry_version
      });
    }
  );

  routes.put<{ Body: VisibilityRequest }>(
    '/v1/account/visibility',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: VisibilityRequestSchema,
        response: {
          200: VisibilityResponseSchema,
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
      const visibility = await database.query<{ id: string }>(
        `UPDATE accounts SET profile_visibility = $2, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
           AND ($2 = 'private' OR email_verification_status = 'verified')
         RETURNING id`,
        [accountId, request.body.activityVisibility]
      );
      if (!visibility.rows[0])
        return reply
          .code(403)
          .send({ message: 'A verified account is required for follower visibility' });
      await audit(database, accountId, 'visibility.updated', 'account', accountId, {
        activityVisibility: request.body.activityVisibility
      });
      return { activityVisibility: request.body.activityVisibility };
    }
  );

  routes.get(
    '/v1/safety-contacts',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: SafetyContactListResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const contacts = await database.query<{
        id: string;
        email: string;
        status: 'pending' | 'accepted';
      }>(
        `SELECT id, email, status FROM safety_contacts
         WHERE account_id = $1 AND status <> 'revoked' ORDER BY created_at DESC`,
        [accountId]
      );
      return { data: contacts.rows };
    }
  );

  routes.post<{ Body: SafetyContactRequest }>(
    '/v1/safety-contacts',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: SafetyContactRequestSchema,
        response: {
          201: SafetyContactResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const email = request.body.email.trim().toLowerCase();
      const eligible = await database.query<{ id: string }>(
        `SELECT contact.id FROM accounts owner CROSS JOIN accounts contact
         WHERE owner.id = $1 AND lower(contact.email) = lower($2) AND contact.id <> owner.id
           AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
           AND contact.email_verified_at IS NOT NULL AND contact.trust_established_at IS NOT NULL
           AND owner.deleted_at IS NULL AND contact.deleted_at IS NULL`,
        [accountId, email]
      );
      if (!eligible.rows[0])
        return reply
          .code(403)
          .send({ message: 'Verified, trusted accounts are required for safety invitations' });
      try {
        const contact = await database.query<{ id: string; email: string; status: 'pending' }>(
          `INSERT INTO safety_contacts (account_id, email) VALUES ($1, $2)
           RETURNING id, email, status`,
          [accountId, email]
        );
        await audit(
          database,
          accountId,
          'safety_contact.invited',
          'safety_contact',
          contact.rows[0]!.id
        );
        return reply.code(201).send(contact.rows[0]!);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return reply.code(409).send({ message: 'Safety contact already exists' });
        throw error;
      }
    }
  );

  routes.post<{ Params: { safetyContactId: string } }>(
    '/v1/safety-contacts/:safetyContactId/accept',
    {
      schema: {
        params: SafetyContactParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: SafetyContactAcceptResponseSchema,
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
      const accepted = await database.query<{ id: string }>(
        `UPDATE safety_contacts safety_contact SET status = 'accepted', accepted_at = now(), updated_at = now()
         FROM accounts contact, accounts owner
         WHERE safety_contact.id = $1 AND lower(safety_contact.email) = lower(contact.email)
           AND contact.id = $2 AND owner.id = safety_contact.account_id
           AND safety_contact.status = 'pending' AND contact.email_verified_at IS NOT NULL
           AND contact.trust_established_at IS NOT NULL AND contact.deleted_at IS NULL
           AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
           AND owner.deleted_at IS NULL
         RETURNING safety_contact.id`,
        [request.params.safetyContactId, accountId]
      );
      if (accepted.rows[0]) {
        await audit(
          database,
          accountId,
          'safety_contact.accepted',
          'safety_contact',
          accepted.rows[0].id
        );
        return { status: 'accepted' as const };
      }
      const existing = await database.query<{ id: string }>(
        'SELECT id FROM safety_contacts WHERE id = $1',
        [request.params.safetyContactId]
      );
      return existing.rows[0]
        ? reply.code(403).send({ message: 'Safety contact cannot be accepted' })
        : reply.code(404).send({ message: 'Safety contact not found' });
    }
  );

  routes.post<{ Body: SafetyShareRequest }>(
    '/v1/safety-shares',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: SafetyShareRequestSchema,
        response: {
          201: SafetyShareResponseSchema,
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
      const contact = await database.query<{ id: string }>(
        `SELECT safety_contact.id
         FROM safety_contacts safety_contact
         JOIN accounts owner ON owner.id = safety_contact.account_id
         JOIN accounts contact ON lower(contact.email) = lower(safety_contact.email)
         WHERE safety_contact.id = $1 AND safety_contact.account_id = $2 AND safety_contact.status = 'accepted'
           AND owner.email_verified_at IS NOT NULL AND owner.trust_established_at IS NOT NULL
           AND contact.email_verified_at IS NOT NULL AND contact.trust_established_at IS NOT NULL
           AND owner.deleted_at IS NULL AND contact.deleted_at IS NULL`,
        [request.body.safetyContactId, accountId]
      );
      if (!contact.rows[0])
        return reply
          .code(403)
          .send({ message: 'An accepted, verified safety contact is required' });
      if (request.body.activityId) {
        const activity = await database.query<{ id: string }>(
          `SELECT id FROM activity_submissions
           WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
          [request.body.activityId, accountId]
        );
        if (!activity.rows[0])
          return reply.code(403).send({ message: 'Activity not available for sharing' });
      }
      const share = await database.query<{
        id: string;
        safety_contact_id: string;
        status: 'active';
        expires_at: Date;
      }>(
        `INSERT INTO safety_share_sessions
           (account_id, safety_contact_id, activity_id, delay_minutes, tile_size_meters, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6::text || ' minutes')::interval)
         RETURNING id, safety_contact_id, status, expires_at`,
        [
          accountId,
          request.body.safetyContactId,
          request.body.activityId ?? null,
          safetyShareDelayMinutes,
          safetyShareTileSizeMeters,
          request.body.durationMinutes
        ]
      );
      await audit(database, accountId, 'safety_share.started', 'safety_share', share.rows[0]!.id);
      return reply.code(201).send({
        id: share.rows[0]!.id,
        safetyContactId: share.rows[0]!.safety_contact_id,
        status: share.rows[0]!.status,
        delayMinutes: safetyShareDelayMinutes,
        tileSizeMeters: safetyShareTileSizeMeters,
        expiresAt: new Date(share.rows[0]!.expires_at).toISOString()
      });
    }
  );

  routes.post<{ Params: { shareId: string }; Body: SafetyShareUpdateRequest }>(
    '/v1/safety-shares/:shareId/updates',
    {
      schema: {
        params: SafetyShareParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        body: SafetyShareUpdateRequestSchema,
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
      const tile = coarseTile(request.body.latitude, request.body.longitude);
      const saved = await database.query<{ id: string }>(
        `INSERT INTO safety_share_updates (share_session_id, tile_x, tile_y, observed_at, available_at)
         SELECT id, $3, $4, least($5::timestamptz, now()), now() + interval '15 minutes'
         FROM safety_share_sessions
         WHERE id = $1 AND account_id = $2 AND status = 'active' AND expires_at > now()
         ON CONFLICT (share_session_id, observed_at) DO NOTHING RETURNING id`,
        [request.params.shareId, accountId, tile.x, tile.y, request.body.observedAt]
      );
      return saved.rows[0]
        ? reply.code(204).send()
        : reply.code(404).send({ message: 'Active safety share not found' });
    }
  );

  routes.get<{ Params: { shareId: string } }>(
    '/v1/safety-shares/:shareId/updates',
    {
      schema: {
        params: SafetyShareParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: SafetyShareReadResponseSchema,
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
      const share = await database.query<{
        status: 'active' | 'revoked' | 'expired';
        delay_minutes: number;
        tile_size_meters: number;
      }>(
        `SELECT session.status, session.delay_minutes, session.tile_size_meters
         FROM safety_share_sessions session
         JOIN safety_contacts contact ON contact.id = session.safety_contact_id
         JOIN accounts recipient ON lower(recipient.email) = lower(contact.email)
         WHERE session.id = $1 AND recipient.id = $2 AND contact.status = 'accepted'
           AND recipient.email_verified_at IS NOT NULL AND recipient.trust_established_at IS NOT NULL
           AND recipient.deleted_at IS NULL`,
        [request.params.shareId, accountId]
      );
      const session = share.rows[0];
      if (!session) return reply.code(404).send({ message: 'Safety share not found' });
      if (session.status !== 'active')
        return reply.code(403).send({ message: 'Safety share is not active' });
      const updates = await database.query<{
        tile_x: number;
        tile_y: number;
        observed_at: Date;
      }>(
        `SELECT tile_x, tile_y, observed_at FROM safety_share_updates
         WHERE share_session_id = $1 AND available_at <= now()
         ORDER BY observed_at DESC LIMIT 100`,
        [request.params.shareId]
      );
      return {
        status: session.status,
        delayMinutes: safetyShareDelayMinutes,
        tileSizeMeters: safetyShareTileSizeMeters,
        updates: updates.rows.map((update) => ({
          tileX: update.tile_x,
          tileY: update.tile_y,
          observedAt: new Date(update.observed_at).toISOString()
        }))
      };
    }
  );

  routes.delete<{ Params: { shareId: string } }>(
    '/v1/safety-shares/:shareId',
    {
      schema: {
        params: SafetyShareParamsSchema,
        headers: ActivityAuthorizationHeadersSchema,
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
      const revoked = await database.query<{ id: string }>(
        `UPDATE safety_share_sessions SET status = 'revoked', revoked_at = now()
         WHERE id = $1 AND account_id = $2 AND status = 'active' RETURNING id`,
        [request.params.shareId, accountId]
      );
      if (!revoked.rows[0])
        return reply.code(404).send({ message: 'Active safety share not found' });
      await audit(
        database,
        accountId,
        'safety_share.revoked',
        'safety_share',
        request.params.shareId
      );
      return reply.code(204).send();
    }
  );
};
