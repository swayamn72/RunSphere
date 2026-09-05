import type { CampaignAudience, CampaignStatus } from '@runsphere/contracts';

export type { CampaignAudience, CampaignStatus };

/**
 * Campaign email rules (Phase 3, milestone 3.9).
 *
 * Marketing email is the only thing RunSphere sends that nobody asked for at
 * the moment it arrives, so the rules about who may send it, to whom, and how
 * many are pure functions here — visible, tested, and identical in the route,
 * the worker, and any later admin surface.
 *
 * Nothing here reads activity, location, or pace. An audience is consent plus
 * broad bands, and that is all it can ever be: the shape is fixed by the
 * contract, and `audienceRefusalReason` refuses anything that slipped through.
 */

/** Staff roles that may draft, schedule, and cancel campaigns. */
export const CAMPAIGN_MANAGER_ROLES = ['admin', 'campaign_manager'] as const;

export const canManageCampaigns = (roles: readonly string[]): boolean =>
  roles.some((role) => (CAMPAIGN_MANAGER_ROLES as readonly string[]).includes(role));

/**
 * Why an audience may not be used, or `undefined` when it is fine.
 *
 * The one rule with teeth: `consentRequired` may not be turned off. It is in
 * the contract as a field rather than an assumption so that a campaign records
 * what it claimed, and the only value that can ever be recorded is `true` —
 * there is no such thing as a marketing email to somebody who did not consent.
 */
export const audienceRefusalReason = (audience: CampaignAudience): string | undefined => {
  if (!audience.consentRequired)
    return 'A campaign audience must require consent; there is no unconsented marketing email.';
  if (audience.recencyBandDays !== undefined && audience.recencyBandDays < 7)
    // A narrow recency band stops being a cohort and starts being "who opened
    // the app yesterday", which is behavioural targeting by another name.
    return 'A recency band must be at least 7 days, so it stays a broad band.';
  // The contract allows locale, app version, and feature cohort because the
  // product decided those are acceptable dimensions — but nothing in this
  // deployment records them yet. Refusing is the honest answer: an audience
  // built on an attribute nobody stores would quietly match everybody or
  // nobody, and either would be a surprise the day it went out.
  if (audience.locale !== undefined)
    return 'This deployment does not record a locale, so an audience cannot select on one yet.';
  if (audience.appVersions !== undefined)
    return 'This deployment does not record an app version, so an audience cannot select on one yet.';
  if (audience.featureCohorts !== undefined)
    return 'This deployment does not record feature cohorts, so an audience cannot select on one yet.';
  return undefined;
};

/** A campaign may only be scheduled while it is still a draft. */
export const campaignSchedulable = (status: CampaignStatus): boolean => status === 'draft';

/**
 * Cancelling is available right up until the send finishes. A campaign that
 * has already gone out cannot be recalled, and pretending otherwise would be
 * the one dishonest button in the tool.
 */
export const campaignCancellable = (status: CampaignStatus): boolean =>
  status === 'draft' || status === 'scheduled' || status === 'paused' || status === 'sending';

/**
 * Whether the worker should start a scheduled campaign now. A time that has
 * passed while nobody swept still starts: the send is late, not skipped.
 */
export const campaignDue = (
  campaign: { status: CampaignStatus; scheduledFor?: Date | undefined },
  now: Date
): boolean =>
  campaign.status === 'scheduled' &&
  campaign.scheduledFor !== undefined &&
  campaign.scheduledFor <= now;

/**
 * How many of a matched audience a campaign may actually take. The cap is a
 * ceiling on reach, applied at queue time so the recipients table is the
 * record of what the cap did rather than a claim about it.
 */
export const cappedRecipientCount = (matchingCount: number, sendCap: number): number =>
  Math.max(0, Math.min(Math.trunc(matchingCount), Math.trunc(sendCap)));

/**
 * The lead time a scheduled campaign needs. Scheduling into the past would
 * send immediately on the next sweep, which is not what "schedule" means to
 * the person clicking it — if they want it now, that should be a deliberate
 * "send now", not a date they mistyped.
 */
export const CAMPAIGN_MINIMUM_LEAD_MINUTES = 15;

export const scheduleTooSoon = (scheduledFor: Date, now: Date): boolean =>
  scheduledFor.getTime() - now.getTime() < CAMPAIGN_MINIMUM_LEAD_MINUTES * 60_000;
