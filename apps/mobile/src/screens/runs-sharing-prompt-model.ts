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

export type PromptApi = Pick<
  MobileApiClient,
  'getLegalConsent' | 'acceptLegalPolicy' | 'getPrivacySettings' | 'savePrivacySettings'
>;

/** Whether to show the prompt. Unknown (offline, server down) never blocks the app. */
export const needsRunsPrompt = async (api: Pick<PromptApi, 'getLegalConsent'>) => {
  try {
    const status: LegalConsentStatus = await api.getLegalConsent();
    return status.needsAcceptance;
  } catch {
    return false;
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
