import type { FastifyInstance } from 'fastify';
import {
  ActivityAuthorizationHeadersSchema,
  AccountDeletionRequestSchema,
  AccountDeletionResponseSchema,
  AccountExportResponseSchema,
  ErrorResponseSchema,
  type AccountDeletionRequest,
  type AccountExportResponse
} from '@runsphere/contracts';
import { withTransaction, type Database } from '@runsphere/db';
import { verifyPassword } from './auth.js';
import { allowAuthAttempt, audit, requireAccount } from './auth-routes.js';
import { settingsFrom, type SettingsRow } from './social-identity-routes.js';

const privacyZoneRadiusMeters = 200;

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);
const numberOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

type ExportData = AccountExportResponse['data'];

/**
 * Everything the privacy notice says we hold, read-only, one query per
 * section. Other runners appear only by username (friends, blocks) or not at
 * all (a report names what kind of thing was reported, never who).
 */
const exportSections = async (
  database: Database,
  accountId: string
): Promise<Omit<ExportData, 'account'>> => {
  const [
    settings,
    zones,
    runs,
    claims,
    xp,
    achievements,
    friends,
    blocked,
    contacts,
    reports,
    notifications,
    devices,
    agreements
  ] = await Promise.all([
    database.query<SettingsRow>('SELECT * FROM privacy_settings WHERE account_id = $1', [
      accountId
    ]),
    database.query<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      geometry_version: number;
    }>(
      `SELECT id, name, ST_Y(center) AS latitude, ST_X(center) AS longitude, geometry_version
       FROM privacy_zones WHERE account_id = $1 ORDER BY created_at`,
      [accountId]
    ),
    database.query<{
      id: string;
      recorded_at: Date;
      status: string;
      run_mode: string | null;
      distance_meters: number | null;
      duration_seconds: number | null;
      raw_gps_kept_until: Date | null;
    }>(
      `SELECT id, COALESCE(client_started_at, created_at) AS recorded_at, status, run_mode,
         (summary->>'distanceMeters')::double precision AS distance_meters,
         (summary->>'durationSeconds')::double precision AS duration_seconds,
         CASE WHEN raw_trace_purged_at IS NULL AND raw_trace_retention_until > now()
           THEN raw_trace_retention_until END AS raw_gps_kept_until
       FROM activity_submissions WHERE account_id = $1 AND deleted_at IS NULL
       ORDER BY recorded_at`,
      [accountId]
    ),
    database.query<{
      id: string;
      activity_id: string | null;
      claimed_at: Date;
      area_sqm: number;
      season_month: string | null;
      released_at: Date | null;
    }>(
      `SELECT id, activity_id, claimed_at, area_sqm, season_month, released_at
       FROM territory_claims WHERE account_id = $1 ORDER BY claimed_at`,
      [accountId]
    ),
    database.query<{ source: string; amount: number; created_at: Date }>(
      'SELECT source, amount, created_at FROM xp_entries WHERE account_id = $1 ORDER BY created_at',
      [accountId]
    ),
    database.query<{ achievement_key: string; awarded_at: Date }>(
      `SELECT achievement_key, awarded_at FROM achievement_awards
       WHERE account_id = $1 ORDER BY awarded_at`,
      [accountId]
    ),
    database.query<{ username: string; created_at: Date }>(
      `SELECT friend.username, friendship.created_at
       FROM friendships friendship JOIN accounts friend ON friend.id = friendship.friend_account_id
       WHERE friendship.account_id = $1 AND friend.deleted_at IS NULL
       ORDER BY friendship.created_at`,
      [accountId]
    ),
    database.query<{ username: string; created_at: Date }>(
      `SELECT other.username, block.created_at
       FROM blocks block JOIN accounts other ON other.id = block.blocked_account_id
       WHERE block.blocker_account_id = $1 AND block.revoked_at IS NULL
         AND other.deleted_at IS NULL
       ORDER BY block.created_at`,
      [accountId]
    ),
    database.query<{ email: string; status: string; created_at: Date }>(
      `SELECT email, status, created_at FROM safety_contacts
       WHERE account_id = $1 ORDER BY created_at`,
      [accountId]
    ),
    database.query<{ subject_type: string; reason: string; status: string; created_at: Date }>(
      `SELECT subject_type, reason, status, created_at FROM reports
       WHERE reporter_account_id = $1 ORDER BY created_at`,
      [accountId]
    ),
    database.query<{
      categories: unknown;
      channels: unknown;
      quiet_hours: unknown;
      marketing_consent: boolean;
    }>(
      `SELECT categories, channels, quiet_hours, marketing_consent
       FROM notification_preferences WHERE account_id = $1`,
      [accountId]
    ),
    database.query<{ platform: string; created_at: Date; last_seen_at: Date | null }>(
      `SELECT platform, created_at, last_seen_at FROM push_devices
       WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [accountId]
    ),
    database.query<{
      consent_type: string;
      granted: boolean;
      policy_version: string;
      recorded_at: Date;
    }>(
      `SELECT consent_type, granted, policy_version, recorded_at FROM consent_history
       WHERE account_id = $1 ORDER BY recorded_at, id`,
      [accountId]
    )
  ]);
  const choices = notifications.rows[0];
  return {
    privacySettings: settings.rows[0] ? settingsFrom(settings.rows[0]) : null,
    privacyZones: zones.rows.map((zone) => ({
      id: zone.id,
      name: zone.name,
      center: { latitude: Number(zone.latitude), longitude: Number(zone.longitude) },
      radiusMeters: privacyZoneRadiusMeters,
      geometryVersion: zone.geometry_version
    })),
    runs: runs.rows.map((run) => ({
      id: run.id,
      recordedAt: iso(run.recorded_at),
      status: run.status,
      runMode: run.run_mode,
      distanceMeters: numberOrNull(run.distance_meters),
      durationSeconds: numberOrNull(run.duration_seconds),
      rawGpsKeptUntil: isoOrNull(run.raw_gps_kept_until)
    })),
    turfClaims: claims.rows.map((claim) => ({
      id: claim.id,
      runId: claim.activity_id,
      claimedAt: iso(claim.claimed_at),
      areaSquareMeters: Number(claim.area_sqm),
      seasonMonth: claim.season_month,
      releasedAt: isoOrNull(claim.released_at)
    })),
    xp: xp.rows.map((entry) => ({
      source: entry.source,
      amount: entry.amount,
      awardedAt: iso(entry.created_at)
    })),
    achievements: achievements.rows.map((award) => ({
      key: award.achievement_key,
      awardedAt: iso(award.awarded_at)
    })),
    friends: friends.rows.map((row) => ({ username: row.username, since: iso(row.created_at) })),
    blocked: blocked.rows.map((row) => ({ username: row.username, since: iso(row.created_at) })),
    safetyContacts: contacts.rows.map((contact) => ({
      email: contact.email,
      status: contact.status,
      addedAt: iso(contact.created_at)
    })),
    reportsMade: reports.rows.map((report) => ({
      about: report.subject_type,
      reason: report.reason,
      status: report.status,
      madeAt: iso(report.created_at)
    })),
    notificationChoices: choices
      ? {
          categories: choices.categories,
          channels: choices.channels,
          quietHours: choices.quiet_hours,
          newsEmails: choices.marketing_consent
        }
      : null,
    devices: devices.rows.map((device) => ({
      platform: device.platform,
      addedAt: iso(device.created_at),
      lastSeenAt: isoOrNull(device.last_seen_at)
    })),
    agreements: agreements.rows.map((row) => ({
      kind: row.consent_type,
      agreed: row.granted,
      version: row.policy_version,
      recordedAt: iso(row.recorded_at)
    }))
  };
};

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
      const account = await database.query<{
        email: string;
        email_verified_at: Date | null;
        username: string;
        display_name: string | null;
        home_area: string | null;
        cosmetic: unknown;
        age_asserted_at: Date;
        created_at: Date;
      }>(
        `SELECT account.email, account.email_verified_at, account.username, profile.display_name,
           account.home_area, profile.cosmetic, account.age_asserted_at, account.created_at
         FROM accounts account LEFT JOIN profiles profile ON profile.account_id = account.id
         WHERE account.id = $1 AND account.deleted_at IS NULL AND account.deletion_requested_at IS NULL`,
        [accountId]
      );
      const profile = account.rows[0];
      if (!profile) return reply.code(401).send({ message: 'Unauthorized' });
      const data = await exportSections(database, accountId);
      await database.query('INSERT INTO account_export_requests (account_id) VALUES ($1)', [
        accountId
      ]);
      await audit(database, accountId, 'account_export.generated', 'account', accountId);
      return {
        status: 'ready' as const,
        generatedAt: new Date().toISOString(),
        data: {
          account: {
            email: profile.email,
            emailVerified: profile.email_verified_at !== null,
            username: profile.username,
            displayName: profile.display_name,
            homeArea: profile.home_area,
            avatar: profile.cosmetic ?? null,
            ageCheckedAt: iso(profile.age_asserted_at),
            createdAt: iso(profile.created_at)
          },
          ...data
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
