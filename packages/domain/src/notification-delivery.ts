import type {
  NotificationCategory,
  NotificationKind,
  NotificationPreferences
} from '@runsphere/contracts';
import { kolkataDayStart } from './gamification.js';

export type { NotificationCategory, NotificationKind, NotificationPreferences };

/**
 * Push-delivery policy (ADR-0009). The durable inbox is written first and
 * unconditionally; this decides only whether the worker may *also* wake a
 * device. Every input is already stored preference data, so the decision is a
 * pure function and one shared vocabulary of reasons is auditable end to end.
 *
 * Nothing here reads the notification title, body, score, or location: the
 * kind alone selects the category, and the payload the worker sends carries
 * only an opaque id and the safe deep link.
 */

/**
 * Which preference toggle governs each inbox kind. Kinds outside a user-facing
 * category (`system`) map to `account`, so an operational notice follows the
 * same switch a security notice does rather than an unswitchable channel.
 */
export const NOTIFICATION_CATEGORY_BY_KIND: Readonly<
  Record<NotificationKind, NotificationCategory>
> = {
  friend_request: 'friends',
  challenge_invite: 'challenges',
  challenge_finished: 'challenges',
  club_invite: 'clubs',
  competition: 'competitions',
  territory_season: 'territory',
  // A carve, a defence, or a ghost race. Same toggle as the season summaries:
  // both are Turf, and splitting the switch would mean somebody could turn off
  // being told their ground was taken while still being ranked on holding it.
  territory_claim: 'territory',
  quest: 'progress',
  streak: 'progress',
  account: 'account',
  system: 'account'
};

/**
 * Delivery defaults for an account that has never opened notification
 * settings. Shared with the API so the preferences route and the worker's
 * decision can never disagree about what "unset" means. Marketing is the one
 * category off by default: it is consent, not a preference.
 */
export const defaultNotificationPreferences = (): NotificationPreferences => ({
  categories: {
    friends: true,
    challenges: true,
    clubs: true,
    competitions: true,
    territory: true,
    progress: true,
    account: true,
    marketing: false
  },
  maxPerDay: 50,
  channels: { push: true, email: false },
  // Off by default, like the category: campaign email is consent, and an
  // unset account has not given it.
  marketingConsent: false
});

/**
 * Stored category toggles, filled in from the defaults.
 *
 * `notification_preferences.categories` is a JSON blob, and a blob written
 * before a category existed does not have its key. Read verbatim that is two
 * bugs at once, and both were live:
 *
 *   * The API's response schema requires every key, so serialising a blob that
 *     is missing one answers **500** — an account could not read or write its
 *     own notification settings at all.
 *   * The worker reads the same blob to decide whether to send, and a missing
 *     key is `undefined`, which is falsy, so an entire category is **silently
 *     suppressed** for that account. Silence is the worse of the two: nothing
 *     reports it.
 *
 * Migrating existing rows fixes neither on its own, because a deploy can reach
 * the read path before the migration runs and because nothing stops a partial
 * write. So the merge lives here, next to the definition of what "unset"
 * means, and every reader goes through it.
 *
 * Unknown and non-boolean keys are dropped rather than passed along: the
 * response schema would reject them, and a toggle nothing governs is worse than
 * no toggle.
 */
export const notificationCategoriesFrom = (
  stored: unknown
): NotificationPreferences['categories'] => {
  const defaults = defaultNotificationPreferences().categories;
  if (typeof stored !== 'object' || stored === null) return defaults;
  const raw = stored as Record<string, unknown>;
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as NotificationCategory[]) {
    const value = raw[key];
    if (typeof value === 'boolean') merged[key] = value;
  }
  return merged;
};

export type PushSuppressionReason =
  'channel_off' | 'category_off' | 'quiet_hours' | 'daily_cap' | 'no_devices';

export type PushDeliveryReason = 'ok' | PushSuppressionReason;

export type PushDeliveryDecision =
  | { readonly deliver: true; readonly reason: 'ok' }
  | { readonly deliver: false; readonly reason: PushSuppressionReason };

export interface PushDeliveryInput {
  readonly kind: NotificationKind;
  readonly preferences: NotificationPreferences;
  /** Live push registrations for the account. Zero means nothing to wake. */
  readonly deviceCount: number;
  /** Pushes already sent to this account in the current local day. */
  readonly sentToday: number;
  /** Observation instant; defaults to the current wall-clock time. */
  readonly now?: Date;
}

const MINUTES_PER_DAY = 24 * 60;

const minutesFromClock = (value: string): number | undefined => {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * Local minute-of-day in an IANA zone. Returns `undefined` for a zone Node
 * cannot resolve: preferences store the zone as free text, and an unusable one
 * must not silence push forever.
 */
export const localMinuteOfDay = (instant: Date, timezone: string): number | undefined => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(instant);
    const read = (type: 'hour' | 'minute'): number =>
      Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
    // 'en-US' renders midnight as hour 24 in some ICU builds.
    const hour = read('hour') % 24;
    const minute = read('minute');
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
    return hour * 60 + minute;
  } catch {
    return undefined;
  }
};

/**
 * Quiet hours are half-open: quiet from `start` inclusive to `end` exclusive,
 * wrapping past midnight when `start` is later than `end`. Equal endpoints are
 * a zero-length window, never a whole silent day.
 */
export const withinQuietHours = (
  quietHours: NonNullable<NotificationPreferences['quietHours']>,
  now: Date
): boolean => {
  const start = minutesFromClock(quietHours.start);
  const end = minutesFromClock(quietHours.end);
  const current = localMinuteOfDay(now, quietHours.timezone);
  if (start === undefined || end === undefined || current === undefined) return false;
  if (start === end) return false;
  const span = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const offset = (current - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return offset < span;
};

/**
 * Start of the local day the frequency cap counts over. Preferences carry a
 * zone only alongside quiet hours, so an account without them is counted on
 * the Asia/Kolkata day every other period in the system uses (ADR-0006).
 */
export const pushCapWindowStart = (
  preferences: NotificationPreferences,
  now: Date = new Date()
): Date => {
  const timezone = preferences.quietHours?.timezone;
  if (timezone === undefined) return kolkataDayStart(now);
  const minuteOfDay = localMinuteOfDay(now, timezone);
  if (minuteOfDay === undefined) return kolkataDayStart(now);
  // Every IANA offset is a whole number of minutes, so the seconds and
  // milliseconds of the instant are the same in any zone.
  const sinceLocalMidnight =
    minuteOfDay * 60_000 + now.getUTCSeconds() * 1_000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - sinceLocalMidnight);
};

/**
 * Order matters and is deliberate: a disabled channel or category is a
 * standing "no", while quiet hours and the daily cap are timing limits. The
 * standing answers are checked first so an audit row says *why* a user is not
 * being reached, not merely that the clock happened to forbid it.
 */
export const pushDeliveryDecision = (input: PushDeliveryInput): PushDeliveryDecision => {
  const { preferences } = input;
  if (!preferences.channels.push) return { deliver: false, reason: 'channel_off' };
  const category = NOTIFICATION_CATEGORY_BY_KIND[input.kind];
  if (preferences.categories[category] !== true) return { deliver: false, reason: 'category_off' };
  if (input.deviceCount <= 0) return { deliver: false, reason: 'no_devices' };
  const now = input.now ?? new Date();
  if (preferences.quietHours && withinQuietHours(preferences.quietHours, now))
    return { deliver: false, reason: 'quiet_hours' };
  if (input.sentToday >= preferences.maxPerDay) return { deliver: false, reason: 'daily_cap' };
  return { deliver: true, reason: 'ok' };
};
