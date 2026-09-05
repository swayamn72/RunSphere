import type {
  InboxEntry,
  NotificationCategory,
  NotificationKind,
  NotificationPreferences,
  NotificationPreferencesUpdateRequest
} from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';

/**
 * The notification inbox and its delivery preferences (milestone 2.9).
 *
 * The inbox is the source of truth (ADR-0009): a push only wakes the device
 * with an id, and this screen is where the entry is actually read. The
 * preferences below are the same ones the worker's push decision reads, so
 * turning a category off here is what stops a push, not a client-side filter.
 */

export type NotificationsRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export const notificationsErrorState = (error: unknown): NotificationsRemoteState => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const inboxState = (entries: readonly InboxEntry[]): NotificationsRemoteState =>
  entries.length ? 'ready' : 'empty';

/** Short label for the kind, in the account's own vocabulary. */
export const NOTIFICATION_KIND_LABEL: Readonly<Record<NotificationKind, string>> = {
  friend_request: 'Friend request',
  challenge_invite: 'Challenge',
  challenge_finished: 'Challenge',
  club_invite: 'Club',
  competition: 'Competition',
  account: 'Account',
  system: 'RunSphere'
};

/**
 * Where an entry can actually take the reader. Only two destinations exist
 * today: challenge notices carry a `runsphere://challenges/<id>` link and Play
 * is the surface that lists challenges, and a friend request belongs to the
 * friends screen. Anything else offers no navigation rather than a dead end —
 * there is no challenge detail screen to deep-link into.
 */
export type NotificationTarget = 'play' | 'friends';

export const notificationTarget = (entry: InboxEntry): NotificationTarget | undefined => {
  if (entry.deepLink?.startsWith('runsphere://challenges/')) return 'play';
  if (entry.kind === 'friend_request') return 'friends';
  return undefined;
};

export const NOTIFICATION_TARGET_LABEL: Readonly<Record<NotificationTarget, string>> = {
  play: 'Open Play',
  friends: 'Open friends'
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const KOLKATA_OFFSET_MS = 19_800_000;

/**
 * Age without `Intl`, which Hermes builds do not always carry. Beyond a week
 * the Asia/Kolkata calendar date is shown, matching the day boundary the
 * server scores on.
 */
export const notificationAgeLabel = (createdAt: string, now: Date = new Date()): string => {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return '';
  const elapsed = now.getTime() - created;
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }
  return new Date(created + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);
};

export interface InboxRow {
  readonly id: string;
  readonly kindLabel: string;
  readonly title: string;
  readonly body: string;
  readonly ageLabel: string;
  readonly unread: boolean;
  readonly target: NotificationTarget | undefined;
  readonly accessibilityLabel: string;
}

export const inboxRows = (
  entries: readonly InboxEntry[],
  now: Date = new Date()
): readonly InboxRow[] =>
  entries.map((entry) => {
    const ageLabel = notificationAgeLabel(entry.createdAt, now);
    const unread = entry.readAt === undefined;
    return {
      id: entry.id,
      kindLabel: NOTIFICATION_KIND_LABEL[entry.kind],
      title: entry.title,
      body: entry.body,
      ageLabel,
      unread,
      target: notificationTarget(entry),
      accessibilityLabel: `${unread ? 'Unread. ' : ''}${NOTIFICATION_KIND_LABEL[entry.kind]}. ${
        entry.title
      }. ${entry.body} ${ageLabel}.`
    };
  });

export const unreadIds = (entries: readonly InboxEntry[]): readonly string[] =>
  entries.filter((entry) => entry.readAt === undefined).map((entry) => entry.id);

/** Categories in the order the settings list presents them. */
export const NOTIFICATION_CATEGORY_ORDER: readonly NotificationCategory[] = [
  'friends',
  'challenges',
  'clubs',
  'competitions',
  'account'
];

export const NOTIFICATION_CATEGORY_LABEL: Readonly<Record<NotificationCategory, string>> = {
  friends: 'Friend requests',
  challenges: 'Challenges',
  clubs: 'Clubs',
  competitions: 'Competitions',
  account: 'Account and security',
  marketing: 'Product news'
};

/**
 * Categories with no producer yet are shown as switchable but honest about it:
 * a toggle that governs nothing must not imply the feature exists.
 */
export const NOTIFICATION_CATEGORY_HINT: Readonly<Partial<Record<NotificationCategory, string>>> = {
  clubs: 'Nothing sends this yet. Clubs arrive in a later release.',
  competitions: 'Nothing sends this yet. Competitions arrive in a later release.'
};

export const toggleCategory = (
  preferences: NotificationPreferences,
  category: NotificationCategory
): NotificationPreferences => ({
  ...preferences,
  categories: { ...preferences.categories, [category]: !preferences.categories[category] }
});

/**
 * Asia/Kolkata is the launch geography and the zone every server-side period
 * is scored in, so quiet hours are stored against it rather than a device
 * setting that could drift from the boundary the cap counts on.
 */
export const QUIET_HOURS_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00', timezone: QUIET_HOURS_TIMEZONE };

export const setQuietHoursEnabled = (
  preferences: NotificationPreferences,
  enabled: boolean
): NotificationPreferences => {
  if (!enabled) {
    // Removing the key, not blanking it: the update sends an explicit null and
    // `exactOptionalPropertyTypes` will not accept `quietHours: undefined`.
    const rest: NotificationPreferences = {
      categories: preferences.categories,
      maxPerDay: preferences.maxPerDay,
      channels: preferences.channels,
      marketingConsent: preferences.marketingConsent
    };
    return rest;
  }
  return { ...preferences, quietHours: preferences.quietHours ?? DEFAULT_QUIET_HOURS };
};

const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const setQuietHoursEdge = (
  preferences: NotificationPreferences,
  edge: 'start' | 'end',
  value: string
): NotificationPreferences => {
  if (!CLOCK.test(value)) return preferences;
  const quietHours = preferences.quietHours ?? DEFAULT_QUIET_HOURS;
  return { ...preferences, quietHours: { ...quietHours, [edge]: value } };
};

export const quietHoursSummary = (preferences: NotificationPreferences): string =>
  preferences.quietHours
    ? `${preferences.quietHours.start} to ${preferences.quietHours.end} India time`
    : 'Off';

/** The contract caps the daily maximum at 1-200; anything else is not saved. */
export const parseDailyCap = (raw: string): number | undefined => {
  if (!/^\d{1,3}$/.test(raw.trim())) return undefined;
  const value = Number(raw.trim());
  return value >= 1 && value <= 200 ? value : undefined;
};

export const setPushEnabled = (
  preferences: NotificationPreferences,
  push: boolean
): NotificationPreferences => ({ ...preferences, channels: { ...preferences.channels, push } });

/**
 * Campaign email consent (milestone 3.9). Turning it on sets all three
 * switches the server requires — the consent flag, the `marketing` category,
 * and the `email` channel — because a member who says yes here means yes, not
 * "yes, if two other toggles elsewhere also happen to be on".
 *
 * Turning it off is an unsubscribe, and clears all three for the same reason.
 */
export const setMarketingConsent = (
  preferences: NotificationPreferences,
  consented: boolean
): NotificationPreferences => ({
  ...preferences,
  marketingConsent: consented,
  categories: { ...preferences.categories, marketing: consented },
  channels: { ...preferences.channels, email: consented }
});

/** Said where consent is given, so what it covers is not a guess. */
export const MARKETING_CONSENT_HINT =
  'Occasional product news by email. Off unless you turn it on, and you can turn it off here or from any email we send. Messages about your own account are not affected.';

/**
 * Only what changed is sent. The route merges a partial body, so sending the
 * whole object would silently rewrite a field another device just changed.
 * Clearing quiet hours is an explicit `null`: `undefined` disappears in JSON
 * and would read as "leave it alone".
 */
export const preferencesDiff = (
  saved: NotificationPreferences,
  edited: NotificationPreferences
): NotificationPreferencesUpdateRequest => {
  const update: NotificationPreferencesUpdateRequest = {};
  if (JSON.stringify(saved.categories) !== JSON.stringify(edited.categories))
    update.categories = edited.categories;
  if (JSON.stringify(saved.channels) !== JSON.stringify(edited.channels))
    update.channels = edited.channels;
  if (saved.maxPerDay !== edited.maxPerDay) update.maxPerDay = edited.maxPerDay;
  if (saved.marketingConsent !== edited.marketingConsent)
    update.marketingConsent = edited.marketingConsent;
  if (JSON.stringify(saved.quietHours) !== JSON.stringify(edited.quietHours))
    update.quietHours = edited.quietHours ?? null;
  return update;
};

export const hasPreferenceEdits = (
  saved: NotificationPreferences,
  edited: NotificationPreferences
): boolean => Object.keys(preferencesDiff(saved, edited)).length > 0;

/**
 * Push cannot be delivered until FCM credentials and a native token source
 * exist, so the switch is presented as a preference that will be honoured
 * rather than as something working today. Saying nothing would let an account
 * believe a push is coming.
 */
export const PUSH_UNAVAILABLE_HINT =
  'Push is not being delivered yet on this build. Your choice is saved and applies as soon as it is. Everything still arrives here.';

export const notificationsStatusMessage = (
  state: NotificationsRemoteState,
  notice: string,
  unread: number
): string => {
  if (notice) return notice;
  if (state === 'configuration')
    return 'Notifications are unavailable until RunSphere is configured.';
  if (state === 'loading') return 'Loading notifications.';
  if (state === 'offline') return 'Notifications are unavailable offline.';
  if (state === 'error') return 'Notifications are unavailable.';
  if (unread === 1) return 'One unread notification.';
  if (unread > 1) return `${unread} unread notifications.`;
  return '';
};
