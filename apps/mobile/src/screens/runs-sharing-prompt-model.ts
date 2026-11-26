import type { LegalConsentStatus, PrivacySettings } from '@runsphere/contracts';
import { failureMessage } from '../failure-copy';
import { ApiFailure, type MobileApiClient } from '../api-client';
import type { Audience } from './privacy-settings-model';

/**
 * "Who sees your runs?" (M9 9.27), shown once to every runner who agreed to the
 * legal text before runs could be seen by others (ADR-0015).
 *
 * It does two things in one step, because they are the same news: it asks who
 * should see your runs, pre-selecting your current setting (Friends unless you
 * changed it), and records that you agreed to the updated privacy notice
 * (9.26). Agreeing without changing the choice keeps your setting. There is no
 * way past it without agreeing, since the notice is what the app now does;
 * the runner can read it first, or sign out.
 */

export const RUNS_PROMPT_TITLE = 'Who sees your runs?';
export const RUNS_PROMPT_LINES: readonly string[] = [
  'Your runs that count now show on your profile.',
  'Whoever you pick sees each run’s distance, time, pace, route and the day.',
  'Anything near your privacy zones is always cut. You can also hide route maps or the first and last 200 m in Privacy & visibility.'
];
export const RUNS_PROMPT_AGREE = 'Agree and continue';
export const RUNS_PROMPT_NOTE = 'By continuing you agree to the updated privacy notice and terms.';

/**
 * Any later change to the legal text (C.7 onwards) gets this plain version:
 * the runner already chose who sees their runs, so asking again would be
 * news that isn't news. The links let them read what changed.
 */
export const UPDATED_PROMPT_TITLE = 'We updated our terms';
export const UPDATED_PROMPT_LINES: readonly string[] = [
  'Our privacy notice, terms of use or community guidelines have changed.',
  'Have a look, then agree to keep running with TURFR.'
];
export const UPDATED_PROMPT_NOTE =
  'By continuing you agree to the updated privacy notice, terms and community guidelines.';

/**
 * The first text under which others could see your runs (ADR-0015). Versions
 * are `YYYY-MM-DD` plus an optional letter and `-draft`, so they sort as
 * text: `2026-11-22-draft` comes before it, `2026-11-22b-draft` and later
 * dates after.
 */
export const RUNS_ON_PROFILES_VERSION = '2026-11-22b';

export type LegalPrompt = 'none' | 'runs' | 'updated';

/** Which prompt an agreed version needs, when the current text differs. */
export const legalPromptFor = (status: LegalConsentStatus): LegalPrompt => {
  if (!status.needsAcceptance) return 'none';
  const accepted = status.acceptedVersion;
  const sawRuns =
    accepted !== null &&
    /^\d{4}-\d{2}-\d{2}/.test(accepted) &&
    accepted >= RUNS_ON_PROFILES_VERSION;
  return sawRuns ? 'updated' : 'runs';
};

export type PromptApi = Pick<
  MobileApiClient,
  'getLegalConsent' | 'acceptLegalPolicy' | 'getPrivacySettings' | 'savePrivacySettings'
>;

/** Which prompt to show, if any. Unknown (offline, server down) never blocks the app. */
export const needsLegalPrompt = async (
  api: Pick<PromptApi, 'getLegalConsent'>
): Promise<LegalPrompt> => {
  try {
    return legalPromptFor(await api.getLegalConsent());
  } catch {
    return 'none';
  }
};

/** The choice to start on: the runner's current setting, else the default. */
export const initialRunsAudience = (
  settings: Pick<PrivacySettings, 'runsVisibility'> | undefined
) => (settings?.runsVisibility ?? 'friends') as Audience;

/**
 * Save the choice, then agree to the notice. The setting is saved only if it
 * changed, so agreeing doesn't mark the other privacy settings as reviewed.
 * Returns an error line for the runner, or undefined when done.
 */
export const agreeToRunsSharing = async (
  api: Pick<PromptApi, 'acceptLegalPolicy' | 'savePrivacySettings'>,
  policyVersion: string,
  chosen: Audience,
  current: Audience
): Promise<string | undefined> => {
  try {
    if (chosen !== current) await api.savePrivacySettings({ runsVisibility: chosen });
    await api.acceptLegalPolicy(policyVersion);
    return undefined;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 409)
      return 'The notice changed again. Close the app and open it to see the latest.';
    return failureMessage(error, "Couldn't save that. Check your connection and try again.");
  }
};
