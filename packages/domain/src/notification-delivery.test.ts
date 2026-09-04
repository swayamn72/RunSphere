import { describe, expect, it } from 'vitest';
import type { NotificationPreferences } from '@runsphere/contracts';
import {
  NOTIFICATION_CATEGORY_BY_KIND,
  localMinuteOfDay,
  pushCapWindowStart,
  pushDeliveryDecision,
  withinQuietHours
} from './notification-delivery.js';

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

const decide = (input: Partial<Parameters<typeof pushDeliveryDecision>[0]> = {}) =>
  pushDeliveryDecision({
    kind: 'friend_request',
    preferences: preferences(),
    deviceCount: 1,
    sentToday: 0,
    now: new Date('2026-09-04T09:00:00.000Z'),
    ...input
  });

describe('notification category mapping', () => {
  it('maps every inbox kind to a user-facing preference toggle', () => {
    expect(Object.values(NOTIFICATION_CATEGORY_BY_KIND)).not.toContain(undefined);
    expect(NOTIFICATION_CATEGORY_BY_KIND.challenge_invite).toBe('challenges');
    expect(NOTIFICATION_CATEGORY_BY_KIND.challenge_finished).toBe('challenges');
  });

  it('governs system notices by the account toggle rather than an unswitchable channel', () => {
    expect(NOTIFICATION_CATEGORY_BY_KIND.system).toBe('account');
  });

  it('never routes an inbox kind through the marketing consent toggle', () => {
    expect(Object.values(NOTIFICATION_CATEGORY_BY_KIND)).not.toContain('marketing');
  });
});

describe('quiet hours', () => {
  const quiet = { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' };

  it('is quiet across a window that wraps past midnight', () => {
    // 18:30Z is 00:00 IST the next day.
    expect(withinQuietHours(quiet, new Date('2026-09-04T18:30:00.000Z'))).toBe(true);
    expect(withinQuietHours(quiet, new Date('2026-09-04T16:30:00.000Z'))).toBe(true);
  });

  it('is not quiet in the middle of the local day', () => {
    expect(withinQuietHours(quiet, new Date('2026-09-04T09:00:00.000Z'))).toBe(false);
  });

  it('includes the start minute and excludes the end minute', () => {
    expect(withinQuietHours(quiet, new Date('2026-09-04T16:30:00.000Z'))).toBe(true);
    expect(withinQuietHours(quiet, new Date('2026-09-04T01:30:00.000Z'))).toBe(false);
  });

  it('treats equal endpoints as a zero-length window, never a silent day', () => {
    const zero = { start: '08:00', end: '08:00', timezone: 'Asia/Kolkata' };
    expect(withinQuietHours(zero, new Date('2026-09-04T02:30:00.000Z'))).toBe(false);
  });

  it('honours a zone other than Kolkata', () => {
    const utc = { start: '22:00', end: '23:00', timezone: 'UTC' };
    expect(withinQuietHours(utc, new Date('2026-09-04T22:30:00.000Z'))).toBe(true);
    expect(withinQuietHours(utc, new Date('2026-09-04T21:30:00.000Z'))).toBe(false);
  });

  it('does not silence push forever when the stored zone is unusable', () => {
    const broken = { start: '00:00', end: '23:59', timezone: 'Not/AZone' };
    expect(localMinuteOfDay(new Date(), 'Not/AZone')).toBeUndefined();
    expect(withinQuietHours(broken, new Date('2026-09-04T09:00:00.000Z'))).toBe(false);
  });
});

describe('frequency cap window', () => {
  it('counts on the Asia/Kolkata day when preferences carry no zone', () => {
    expect(
      pushCapWindowStart(preferences(), new Date('2026-09-04T09:00:00.000Z')).toISOString()
    ).toBe('2026-09-03T18:30:00.000Z');
  });

  it('counts on the account zone when quiet hours declare one', () => {
    const withZone = preferences({
      quietHours: { start: '22:00', end: '07:00', timezone: 'UTC' }
    });
    expect(pushCapWindowStart(withZone, new Date('2026-09-04T09:20:31.250Z')).toISOString()).toBe(
      '2026-09-04T00:00:00.000Z'
    );
  });

  it('falls back to the Kolkata day when the stored zone is unusable', () => {
    const broken = preferences({
      quietHours: { start: '22:00', end: '07:00', timezone: 'Not/AZone' }
    });
    expect(pushCapWindowStart(broken, new Date('2026-09-04T09:00:00.000Z')).toISOString()).toBe(
      '2026-09-03T18:30:00.000Z'
    );
  });
});

describe('push delivery decision', () => {
  it('delivers when the channel, category, devices, clock, and cap all allow it', () => {
    expect(decide()).toEqual({ deliver: true, reason: 'ok' });
  });

  it('reports a disabled push channel ahead of any timing limit', () => {
    const quiet = decide({
      preferences: preferences({
        channels: { push: false, email: false },
        quietHours: { start: '00:00', end: '23:59', timezone: 'Asia/Kolkata' }
      }),
      sentToday: 999
    });
    expect(quiet).toEqual({ deliver: false, reason: 'channel_off' });
  });

  it('reports a disabled category ahead of quiet hours', () => {
    expect(
      decide({
        kind: 'challenge_invite',
        preferences: preferences({
          categories: { ...preferences().categories, challenges: false },
          quietHours: { start: '00:00', end: '23:59', timezone: 'Asia/Kolkata' }
        })
      })
    ).toEqual({ deliver: false, reason: 'category_off' });
  });

  it('suppresses an account with no live registration', () => {
    expect(decide({ deviceCount: 0 })).toEqual({ deliver: false, reason: 'no_devices' });
  });

  it('suppresses inside quiet hours', () => {
    expect(
      decide({
        preferences: preferences({
          quietHours: { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' }
        }),
        now: new Date('2026-09-04T18:30:00.000Z')
      })
    ).toEqual({ deliver: false, reason: 'quiet_hours' });
  });

  it('suppresses once the daily cap is reached and not before', () => {
    expect(decide({ sentToday: 49 })).toEqual({ deliver: true, reason: 'ok' });
    expect(decide({ sentToday: 50 })).toEqual({ deliver: false, reason: 'daily_cap' });
  });

  it('treats a missing category toggle as off rather than as consent', () => {
    const partial = preferences();
    delete (partial.categories as Partial<typeof partial.categories>).friends;
    expect(decide({ preferences: partial })).toEqual({ deliver: false, reason: 'category_off' });
  });
});
