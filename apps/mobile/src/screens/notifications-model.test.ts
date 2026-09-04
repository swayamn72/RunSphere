import { describe, expect, it } from 'vitest';
import type { InboxEntry, NotificationPreferences } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import {
  DEFAULT_QUIET_HOURS,
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_CATEGORY_ORDER,
  NOTIFICATION_KIND_LABEL,
  hasPreferenceEdits,
  inboxRows,
  inboxState,
  notificationAgeLabel,
  notificationTarget,
  notificationsErrorState,
  notificationsStatusMessage,
  parseDailyCap,
  preferencesDiff,
  quietHoursSummary,
  setPushEnabled,
  setQuietHoursEdge,
  setQuietHoursEnabled,
  toggleCategory,
  unreadIds
} from './notifications-model';

const NOW = new Date('2026-09-04T12:00:00.000Z');

const entry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
  id: 'n-1',
  kind: 'challenge_invite',
  title: 'New challenge invite',
  body: 'A friend invited you to a challenge.',
  createdAt: '2026-09-04T11:30:00.000Z',
  ...overrides
});

const preferences = (
  overrides: Partial<NotificationPreferences> = {}
): NotificationPreferences => ({
  categories: {
    friends: true,
    challenges: true,
    clubs: true,
    competitions: true,
    account: true,
    marketing: false
  },
  maxPerDay: 50,
  channels: { push: true, email: false },
  ...overrides
});

describe('inbox rows', () => {
  it('names the kind and marks an unread entry for a screen reader', () => {
    const [row] = inboxRows([entry()], NOW);
    expect(row!.kindLabel).toBe('Challenge');
    expect(row!.unread).toBe(true);
    expect(row!.accessibilityLabel).toContain('Unread. Challenge. New challenge invite.');
    expect(row!.accessibilityLabel).toContain('30 minutes ago');
  });

  it('does not announce a read entry as unread', () => {
    const [row] = inboxRows([entry({ readAt: '2026-09-04T11:45:00.000Z' })], NOW);
    expect(row!.unread).toBe(false);
    expect(row!.accessibilityLabel).not.toContain('Unread');
  });

  it('collects only the unread ids to mark read', () => {
    expect(
      unreadIds([
        entry({ id: 'a' }),
        entry({ id: 'b', readAt: '2026-09-04T11:45:00.000Z' }),
        entry({ id: 'c' })
      ])
    ).toEqual(['a', 'c']);
  });

  it('gives every inbox kind a label', () => {
    expect(Object.values(NOTIFICATION_KIND_LABEL)).not.toContain(undefined);
    expect(NOTIFICATION_KIND_LABEL.system).toBe('RunSphere');
  });
});

describe('age label', () => {
  it('counts up in units a reader can act on, without Intl', () => {
    expect(notificationAgeLabel('2026-09-04T11:59:30.000Z', NOW)).toBe('Just now');
    expect(notificationAgeLabel('2026-09-04T11:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(notificationAgeLabel('2026-09-04T11:30:00.000Z', NOW)).toBe('30 minutes ago');
    expect(notificationAgeLabel('2026-09-04T11:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(notificationAgeLabel('2026-09-04T02:00:00.000Z', NOW)).toBe('10 hours ago');
    expect(notificationAgeLabel('2026-09-03T02:00:00.000Z', NOW)).toBe('Yesterday');
    expect(notificationAgeLabel('2026-09-01T02:00:00.000Z', NOW)).toBe('3 days ago');
  });

  it('falls back to the Asia/Kolkata calendar date beyond a week', () => {
    expect(notificationAgeLabel('2026-08-20T20:00:00.000Z', NOW)).toBe('2026-08-21');
  });

  it('says nothing rather than NaN for an unparseable timestamp', () => {
    expect(notificationAgeLabel('not a date', NOW)).toBe('');
  });
});

describe('deep-link target', () => {
  it('sends a challenge notice to Play, the surface that lists challenges', () => {
    expect(notificationTarget(entry({ deepLink: 'runsphere://challenges/abc' }))).toBe('play');
    expect(
      notificationTarget(
        entry({ kind: 'challenge_finished', deepLink: 'runsphere://challenges/x' })
      )
    ).toBe('play');
  });

  it('sends a friend request to the friends screen even with no link stored', () => {
    expect(notificationTarget(entry({ kind: 'friend_request' }))).toBe('friends');
  });

  it('offers no navigation rather than a dead end for anything else', () => {
    expect(notificationTarget(entry({ kind: 'system' }))).toBeUndefined();
    expect(notificationTarget(entry({ kind: 'account' }))).toBeUndefined();
    expect(
      notificationTarget(entry({ kind: 'club_invite', deepLink: 'runsphere://clubs/1' }))
    ).toBeUndefined();
  });
});

describe('categories', () => {
  it('lists every switchable category except marketing consent', () => {
    expect(NOTIFICATION_CATEGORY_ORDER).not.toContain('marketing');
    for (const category of NOTIFICATION_CATEGORY_ORDER)
      expect(NOTIFICATION_CATEGORY_LABEL[category]).toBeTruthy();
  });

  it('flips one category and leaves the rest alone', () => {
    const next = toggleCategory(preferences(), 'challenges');
    expect(next.categories.challenges).toBe(false);
    expect(next.categories.friends).toBe(true);
    expect(toggleCategory(next, 'challenges').categories.challenges).toBe(true);
  });
});

describe('quiet hours', () => {
  it('starts from a sensible evening window when switched on', () => {
    expect(setQuietHoursEnabled(preferences(), true).quietHours).toEqual(DEFAULT_QUIET_HOURS);
  });

  it('removes the window entirely when switched off, rather than storing a blank one', () => {
    const on = setQuietHoursEnabled(preferences(), true);
    expect('quietHours' in setQuietHoursEnabled(on, false)).toBe(false);
  });

  it('only accepts a 24-hour clock value', () => {
    const on = setQuietHoursEnabled(preferences(), true);
    expect(setQuietHoursEdge(on, 'start', '23:15').quietHours?.start).toBe('23:15');
    expect(setQuietHoursEdge(on, 'start', '24:00').quietHours?.start).toBe('22:00');
    expect(setQuietHoursEdge(on, 'end', '7am').quietHours?.end).toBe('07:00');
  });

  it('reads back the window, and Off when there is none', () => {
    expect(quietHoursSummary(preferences())).toBe('Off');
    expect(quietHoursSummary(setQuietHoursEnabled(preferences(), true))).toBe(
      '22:00 to 07:00 India time'
    );
  });
});

describe('daily cap', () => {
  it('accepts only the range the contract allows', () => {
    expect(parseDailyCap('1')).toBe(1);
    expect(parseDailyCap(' 25 ')).toBe(25);
    expect(parseDailyCap('200')).toBe(200);
    expect(parseDailyCap('0')).toBeUndefined();
    expect(parseDailyCap('201')).toBeUndefined();
    expect(parseDailyCap('')).toBeUndefined();
    expect(parseDailyCap('ten')).toBeUndefined();
  });
});

describe('saving preferences', () => {
  it('sends only what changed, so another device edit is not overwritten', () => {
    const saved = preferences();
    const edited = toggleCategory(saved, 'clubs');
    expect(preferencesDiff(saved, edited)).toEqual({ categories: edited.categories });
  });

  it('sends nothing when nothing changed', () => {
    const saved = preferences();
    expect(preferencesDiff(saved, preferences())).toEqual({});
    expect(hasPreferenceEdits(saved, preferences())).toBe(false);
  });

  it('carries a quiet-hours removal as an explicit null, not a dropped key', () => {
    const saved = setQuietHoursEnabled(preferences(), true);
    const edited = setQuietHoursEnabled(saved, false);
    expect(hasPreferenceEdits(saved, edited)).toBe(true);
    expect(preferencesDiff(saved, edited)).toEqual({ quietHours: null });
  });

  it('carries the push channel and the cap independently', () => {
    const saved = preferences();
    expect(preferencesDiff(saved, setPushEnabled(saved, false))).toEqual({
      channels: { push: false, email: false }
    });
    expect(preferencesDiff(saved, { ...saved, maxPerDay: 10 })).toEqual({ maxPerDay: 10 });
  });
});

describe('state and status', () => {
  it('is empty only with no entries', () => {
    expect(inboxState([])).toBe('empty');
    expect(inboxState([entry()])).toBe('ready');
  });

  it('maps transport failures the way every other screen does', () => {
    expect(notificationsErrorState(new AuthFailure('network'))).toBe('offline');
    expect(notificationsErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(notificationsErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(notificationsErrorState(new Error('boom'))).toBe('error');
  });

  it('announces a notice first, then the unread count', () => {
    expect(notificationsStatusMessage('ready', 'Saved.', 4)).toBe('Saved.');
    expect(notificationsStatusMessage('ready', '', 1)).toBe('One unread notification.');
    expect(notificationsStatusMessage('ready', '', 3)).toBe('3 unread notifications.');
    expect(notificationsStatusMessage('ready', '', 0)).toBe('');
    expect(notificationsStatusMessage('offline', '', 0)).toContain('offline');
  });
});
