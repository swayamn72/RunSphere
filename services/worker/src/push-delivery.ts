import { createSign } from 'node:crypto';
import type { Database } from '@runsphere/db';
import type { Logger } from '@runsphere/observability';
import {
  defaultNotificationPreferences,
  pushCapWindowStart,
  pushDeliveryDecision,
  type NotificationKind,
  type NotificationPreferences,
  type PushDeliveryReason
} from '@runsphere/domain';

/**
 * Push delivery for `notification.created` (ADR-0009).
 *
 * The durable inbox row is already written and is the source of truth. A push
 * is only a wake-up: the message carries the notification id and the safe deep
 * link that inbox row already stores, and nothing else. Titles, bodies, scores,
 * coordinates, and friend identities never reach the provider, so a push
 * transport that logs its traffic leaks no personal data.
 *
 * Whether to send at all is a pure decision in `@runsphere/domain`, recorded in
 * `push_dispatches` with the same reason vocabulary, so "why did I not get a
 * push" is answerable from one table.
 */

export const NOTIFICATION_TOPIC = 'notification.created';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const ACCESS_TOKEN_LIFETIME_SECONDS = 3_600;
// Refresh a little early so a token cannot expire between mint and send.
const ACCESS_TOKEN_SKEW_MS = 60_000;

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface PushMessage {
  token: string;
  notificationId: string;
  deepLink?: string;
}

/**
 * `unregistered` is deliberately distinct from `failed`: the first means the
 * address is permanently dead and must be revoked, the second is transient and
 * must be retried under the outbox attempt budget.
 */
export type PushSendResult = 'sent' | 'unregistered' | 'failed';
export type PushSender = (message: PushMessage) => Promise<PushSendResult>;

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Credentials are all or nothing. A half-configured provider would fail every
 * event until the attempt budget burned out, permanently marking deliverable
 * notifications as failed.
 */
export const readFcmCredentials = (environment: NodeJS.ProcessEnv): FcmCredentials | undefined => {
  const projectId = environment.FCM_PROJECT_ID?.trim();
  const clientEmail = environment.FCM_CLIENT_EMAIL?.trim();
  // Service-account keys are commonly carried through env with escaped newlines.
  const privateKey = environment.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) return undefined;
  return { projectId, clientEmail, privateKey };
};

const base64Url = (value: Buffer | string): string =>
  (typeof value === 'string' ? Buffer.from(value) : value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Signed service-account assertion, so no third-party auth library is needed. */
export const signServiceAccountJwt = (credentials: FcmCredentials, issuedAt: number): string => {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS
    })
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(credentials.privateKey);
  return `${header}.${claims}.${base64Url(signature)}`;
};

export interface FcmSenderOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/**
 * FCM HTTP v1 sender. Messages are data-only: a `notification` payload would
 * ask the provider to render a title and body, which is exactly the content
 * this design keeps server-side.
 */
export const createFcmSender = (
  credentials: FcmCredentials,
  options: FcmSenderOptions = {}
): PushSender => {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? (() => new Date());
  let accessToken: { value: string; expiresAt: number } | undefined;

  const currentAccessToken = async (): Promise<string> => {
    const instant = now().getTime();
    if (accessToken && accessToken.expiresAt - ACCESS_TOKEN_SKEW_MS > instant)
      return accessToken.value;
    const assertion = signServiceAccountJwt(credentials, Math.floor(instant / 1000));
    const response = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });
    if (!response.ok) throw new Error(`push token exchange failed with status ${response.status}`);
    const body = JSON.parse(await response.text()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) throw new Error('push token exchange returned no access token');
    accessToken = {
      value: body.access_token,
      expiresAt: instant + (body.expires_in ?? ACCESS_TOKEN_LIFETIME_SECONDS) * 1000
    };
    return accessToken.value;
  };

  return async (message) => {
    const token = await currentAccessToken();
    const response = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            // Data-only. The client reads the inbox entry by id and renders it
            // from its own state, so the provider never sees the text.
            data: {
              notificationId: message.notificationId,
              ...(message.deepLink ? { deepLink: message.deepLink } : {})
            },
            android: { priority: 'NORMAL' }
          }
        })
      }
    );
    if (response.ok) return 'sent';
    // 404 UNREGISTERED, and a 400 naming the token, both mean the address is
    // gone for good; anything else may succeed on a later attempt.
    if (response.status === 404) return 'unregistered';
    if (response.status === 400) {
      const body = await response.text();
      return /UNREGISTERED|INVALID_ARGUMENT/i.test(body) ? 'unregistered' : 'failed';
    }
    return 'failed';
  };
};

export type DeliveryHandler = (
  topic: string,
  aggregateId: string,
  payload: unknown
) => Promise<void>;

export interface PushDeliveryDeps {
  db: Database;
  /** Absent until FCM credentials are configured; the handler then no-ops. */
  sender?: PushSender;
  logger: Logger;
  now?: () => Date;
}

interface NotificationRow {
  id: string;
  account_id: string;
  kind: NotificationKind;
  deep_link: string | null;
}

interface PreferencesRow {
  categories: unknown;
  quiet_hours: unknown;
  max_per_day: number;
  channels: unknown;
}

const preferencesFromRow = (row: PreferencesRow | undefined): NotificationPreferences => {
  if (!row) return defaultNotificationPreferences();
  const preferences: NotificationPreferences = {
    categories: row.categories as NotificationPreferences['categories'],
    maxPerDay: row.max_per_day,
    channels: row.channels as NotificationPreferences['channels']
  };
  if (row.quiet_hours)
    preferences.quietHours = row.quiet_hours as NonNullable<NotificationPreferences['quietHours']>;
  return preferences;
};

const recordDispatch = (
  db: Database,
  notificationId: string,
  accountId: string,
  decision: 'sent' | 'suppressed',
  reason: PushDeliveryReason,
  deviceCount: number
): Promise<unknown> =>
  db.query(
    `INSERT INTO push_dispatches (notification_id, account_id, decision, reason, device_count)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (notification_id) DO NOTHING`,
    [notificationId, accountId, decision, reason, deviceCount]
  );

/**
 * Builds the worker's delivery handler. Transactional email stays deferred:
 * this milestone wires push only, and an explicit deferral is more honest than
 * silently dropping an email event.
 */
export const createPushDelivery = ({
  db,
  sender,
  logger,
  now = () => new Date()
}: PushDeliveryDeps): DeliveryHandler => {
  return async (topic, aggregateId) => {
    if (topic !== NOTIFICATION_TOPIC) {
      logger.info('delivery.deferred', { topic });
      return;
    }
    if (!sender) {
      logger.info('push.provider_unconfigured', { topic });
      return;
    }
    const notification = await db.query<NotificationRow>(
      'SELECT id, account_id, kind, deep_link FROM notification_inbox WHERE id = $1',
      [aggregateId]
    );
    const row = notification.rows[0];
    // The inbox row can be gone by the time delivery runs — an erased account
    // cascades it away — and there is then nobody to wake.
    if (!row) {
      logger.info('push.notification_absent', { notificationId: aggregateId });
      return;
    }

    const already = await db.query<{ notification_id: string }>(
      'SELECT notification_id FROM push_dispatches WHERE notification_id = $1',
      [row.id]
    );
    if (already.rows[0]) return;

    const preferenceRows = await db.query<PreferencesRow>(
      `SELECT categories, quiet_hours, max_per_day, channels
       FROM notification_preferences WHERE account_id = $1`,
      [row.account_id]
    );
    const preferences = preferencesFromRow(preferenceRows.rows[0]);
    const devices = await db.query<{ id: string; token: string }>(
      'SELECT id, token FROM push_devices WHERE account_id = $1 AND revoked_at IS NULL',
      [row.account_id]
    );
    const instant = now();
    const sentToday = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM push_dispatches
       WHERE account_id = $1 AND decision = 'sent' AND dispatched_at >= $2`,
      [row.account_id, pushCapWindowStart(preferences, instant).toISOString()]
    );

    const decision = pushDeliveryDecision({
      kind: row.kind,
      preferences,
      deviceCount: devices.rows.length,
      sentToday: Number(sentToday.rows[0]?.count ?? 0),
      now: instant
    });
    if (!decision.deliver) {
      await recordDispatch(db, row.id, row.account_id, 'suppressed', decision.reason, 0);
      logger.info('push.suppressed', { notificationId: row.id, reason: decision.reason });
      return;
    }

    let delivered = 0;
    let unregistered = 0;
    let failed = 0;
    for (const device of devices.rows) {
      const result = await sender({
        token: device.token,
        notificationId: row.id,
        ...(row.deep_link ? { deepLink: row.deep_link } : {})
      });
      if (result === 'sent') delivered += 1;
      else if (result === 'unregistered') {
        unregistered += 1;
        await db.query(
          `UPDATE push_devices SET revoked_at = now(), revoke_reason = 'provider_unregistered'
           WHERE id = $1 AND revoked_at IS NULL`,
          [device.id]
        );
      } else failed += 1;
    }

    // Every address turned out to be permanently gone: record a suppression
    // rather than a send of zero, so the audit row stays truthful.
    if (delivered === 0 && failed === 0) {
      await recordDispatch(db, row.id, row.account_id, 'suppressed', 'no_devices', 0);
      logger.info('push.addresses_expired', { notificationId: row.id, unregistered });
      return;
    }
    // Nothing landed and the failures were transient: leave the dispatch row
    // unwritten so the outbox retries under its own attempt budget.
    if (delivered === 0) throw new Error(`push delivery failed for ${failed} device(s)`);

    await recordDispatch(db, row.id, row.account_id, 'sent', 'ok', delivered);
    logger.info('push.sent', { notificationId: row.id, delivered, unregistered, failed });
  };
};
