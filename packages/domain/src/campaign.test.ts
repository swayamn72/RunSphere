import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_MINIMUM_LEAD_MINUTES,
  audienceRefusalReason,
  campaignCancellable,
  campaignDue,
  campaignSchedulable,
  canManageCampaigns,
  cappedRecipientCount,
  scheduleTooSoon
} from './campaign.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const consented = { consentRequired: true };

describe('who may send campaign email', () => {
  it('is the campaign manager and the admin, and nobody else', () => {
    expect(canManageCampaigns(['campaign_manager'])).toBe(true);
    expect(canManageCampaigns(['admin'])).toBe(true);
    expect(canManageCampaigns(['moderator', 'season_operator'])).toBe(false);
    expect(canManageCampaigns([])).toBe(false);
  });
});

describe('what an audience may be', () => {
  it('accepts consent alone', () => {
    expect(audienceRefusalReason(consented)).toBeUndefined();
  });

  it('refuses an audience that does not require consent', () => {
    // The field exists so a campaign records what it claimed; the only value
    // it can ever record is true.
    expect(audienceRefusalReason({ consentRequired: false })).toContain('must require consent');
  });

  it('keeps a recency band broad', () => {
    expect(audienceRefusalReason({ ...consented, recencyBandDays: 6 })).toContain(
      'at least 7 days'
    );
    expect(audienceRefusalReason({ ...consented, recencyBandDays: 7 })).toBeUndefined();
    expect(audienceRefusalReason({ ...consented, recencyBandDays: 90 })).toBeUndefined();
  });

  it('refuses dimensions nothing records yet, rather than matching nobody in silence', () => {
    expect(audienceRefusalReason({ ...consented, locale: 'en-IN' })).toContain(
      'does not record a locale'
    );
    expect(audienceRefusalReason({ ...consented, appVersions: ['1.0.0'] })).toContain(
      'does not record an app version'
    );
    expect(audienceRefusalReason({ ...consented, featureCohorts: ['beta'] })).toContain(
      'does not record feature cohorts'
    );
  });
});

describe('the campaign lifecycle', () => {
  it('lets only a draft be scheduled', () => {
    expect(campaignSchedulable('draft')).toBe(true);
    for (const status of ['scheduled', 'sending', 'paused', 'sent', 'cancelled'] as const)
      expect(campaignSchedulable(status)).toBe(false);
  });

  it('lets anything be cancelled until it has gone out', () => {
    for (const status of ['draft', 'scheduled', 'paused', 'sending'] as const)
      expect(campaignCancellable(status)).toBe(true);
    // A sent campaign cannot be recalled, and a cancel button that pretended
    // otherwise would be the one dishonest control in the tool.
    expect(campaignCancellable('sent')).toBe(false);
    expect(campaignCancellable('cancelled')).toBe(false);
  });

  it('starts a scheduled campaign when its time has come, however late', () => {
    const scheduled = { status: 'scheduled' as const, scheduledFor: NOW };
    expect(campaignDue(scheduled, new Date('2026-09-05T11:59:00.000Z'))).toBe(false);
    expect(campaignDue(scheduled, NOW)).toBe(true);
    // Late is not skipped: a campaign silently never going out is worse than
    // one arriving an hour after it was meant to.
    expect(campaignDue(scheduled, new Date('2026-09-06T12:00:00.000Z'))).toBe(true);
  });

  it('never starts a draft or a cancelled campaign by the clock', () => {
    expect(campaignDue({ status: 'draft', scheduledFor: NOW }, NOW)).toBe(false);
    expect(campaignDue({ status: 'cancelled', scheduledFor: NOW }, NOW)).toBe(false);
    expect(campaignDue({ status: 'scheduled' }, NOW)).toBe(false);
  });
});

describe('the send cap', () => {
  it('is a ceiling on reach, never a floor', () => {
    expect(cappedRecipientCount(1000, 250)).toBe(250);
    expect(cappedRecipientCount(10, 250)).toBe(10);
    expect(cappedRecipientCount(0, 250)).toBe(0);
  });

  it('never returns a negative or fractional count', () => {
    expect(cappedRecipientCount(-5, 250)).toBe(0);
    expect(cappedRecipientCount(10.9, 250)).toBe(10);
  });
});

describe('scheduling lead time', () => {
  it('refuses a schedule too close to now to be cancelled', () => {
    expect(scheduleTooSoon(new Date('2026-09-05T12:10:00.000Z'), NOW)).toBe(true);
    expect(scheduleTooSoon(new Date('2026-09-05T11:00:00.000Z'), NOW)).toBe(true);
    expect(
      scheduleTooSoon(new Date(NOW.getTime() + CAMPAIGN_MINIMUM_LEAD_MINUTES * 60_000), NOW)
    ).toBe(false);
  });
});
