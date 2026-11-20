import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  AccountDeletionRequestSchema,
  AccountDeletionResponseSchema,
  AccountExportResponseSchema,
  ErrorResponseSchema,
  type AccountDeletionRequest
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import { verifyPassword } from './auth.js';
import { allowAuthAttempt, audit, requireAccount } from './auth-routes.js';

const privacyZoneRadiusMeters = 200;

export interface AccountPrivacyRouteDeps {
  routes: FastifyInstance;
  database: Database | undefined;
  authSecret: string;
}

export const registerAccountPrivacyRoutes = ({
  routes,
  database,
  authSecret
}: AccountPrivacyRouteDeps) => {
  routes.get(
    '/v1/account/export',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          200: AccountExportResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      const [account, zones, activities] = await Promise.all([
        database.query<{ email: string; profile_visibility: 'private' | 'followers' }>(
          'SELECT email, profile_visibility FROM accounts WHERE id = $1 AND deleted_at IS NULL',
          [accountId]
        ),
        database.query<{
          id: string;
          name: string;
          latitude: number;
          longitude: number;
          geometry_version: number;
        }>(
          `SELECT id, name, ST_Y(center) AS latitude, ST_X(center) AS longitude, geometry_version
           FROM privacy_zones WHERE account_id = $1`,
          [accountId]
        ),
        database.query<{ id: string; raw_trace_available: boolean }>(
          `SELECT id, raw_trace_retention_until > now() AND raw_trace_purged_at IS NULL AS raw_trace_available
           FROM activity_submissions WHERE account_id = $1 AND deleted_at IS NULL`,
          [accountId]
        )
      ]);
      const profile = account.rows[0];
      if (!profile) return reply.code(401).send({ message: 'Unauthorized' });
      await database.query('INSERT INTO account_export_requests (account_id) VALUES ($1)', [
        accountId
      ]);
      await audit(database, accountId, 'account_export.generated', 'account', accountId);
      return {
        status: 'ready' as const,
        generatedAt: new Date().toISOString(),
        rawTraceAvailability: 'available-within-retention-window' as const,
        data: {
          profile: {
            email: profile.email,
            activityVisibility: profile.profile_visibility
          },
          privacyZones: zones.rows.map((zone) => ({
            id: zone.id,
            name: zone.name,
            center: { latitude: Number(zone.latitude), longitude: Number(zone.longitude) },
            radiusMeters: privacyZoneRadiusMeters,
            geometryVersion: zone.geometry_version
          })),
          activities: activities.rows.map((activity) => ({
            id: activity.id,
            rawTraceAvailable: activity.raw_trace_available
          }))
        }
      };
    }
  );

  /**
   * In-app erasure (ADR-0012). The password is checked first because erasure
   * cannot be undone and an access token on its own may have come off a lost
   * or shared phone. On success the account is withdrawn from every surface at
   * once — sessions, shares, visibility — and the worker erases it on its next
   * sweep, which is the "without undue delay" the DPDP Act and GDPR require.
   * There is deliberately no grace period: nothing is kept "just in case".
   */
  routes.delete<{ Body: AccountDeletionRequest }>(
    '/v1/account',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        body: AccountDeletionRequestSchema,
        response: {
          202: AccountDeletionResponseSchema,
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
      if (!allowAuthAttempt(`account-deletion:${accountId}`))
        return reply.code(429).send({ message: 'Too many attempts' });
      const account = await database.query<{ password_hash: string }>(
        'SELECT password_hash FROM accounts WHERE id = $1 AND deleted_at IS NULL',
        [accountId]
      );
      if (!account.rows[0]) return reply.code(401).send({ message: 'Unauthorized' });
      if (!(await verifyPassword(account.rows[0].password_hash, request.body.password)))
        return reply.code(403).send({ message: 'Password is incorrect' });
      await withTransaction(database, async (client) => {
        await client.query(
          `UPDATE accounts SET deletion_requested_at = coalesce(deletion_requested_at, now()),
           profile_visibility = 'private', updated_at = now() WHERE id = $1`,
          [accountId]
        );
        // Every device is signed out now rather than when the worker gets to
        // the account: a refresh token must not outlive the request to erase.
        await client.query(
          `UPDATE refresh_token_families SET revoked_at = coalesce(revoked_at, now())
           WHERE account_id = $1 AND revoked_at IS NULL`,
          [accountId]
        );
        await client.query(
          `UPDATE safety_share_sessions SET status = 'revoked', revoked_at = now()
           WHERE account_id = $1 AND status = 'active'`,
          [accountId]
        );
        await client.query(
          `INSERT INTO privacy_audit_events (account_id, actor_account_id, event_type, resource_type, resource_id)
           VALUES ($1, $1, 'account_deletion.requested', 'account', $1)`,
          [accountId]
        );
      });
      return reply.code(202).send({ status: 'scheduled' });
    }
  );
};
