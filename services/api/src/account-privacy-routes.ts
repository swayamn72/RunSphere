import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  AccountDeletionResponseSchema,
  AccountExportResponseSchema,
  ErrorResponseSchema
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import { audit, requireAccount } from './auth-routes.js';

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

  routes.delete(
    '/v1/account',
    {
      schema: {
        headers: ActivityAuthorizationHeadersSchema,
        response: {
          202: AccountDeletionResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!database) return reply.code(503).send({ message: 'Service unavailable' });
      const accountId = requireAccount(request, reply, authSecret);
      if (!accountId) return;
      await withTransaction(database, async (client) => {
        await client.query(
          `UPDATE accounts SET deletion_requested_at = coalesce(deletion_requested_at, now()),
           profile_visibility = 'private', updated_at = now() WHERE id = $1`,
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
