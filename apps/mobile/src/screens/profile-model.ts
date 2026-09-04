import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';

/**
 * Presentation for the account's own profile (milestone 2.9). The profile is
 * the only identity a social surface may reveal, so this module never invents
 * one: a placeholder person on a private profile is exactly the untruthful
 * surface the redesign removed from Home and Explore.
 */

/** Initials from the account's own display name, or a neutral mark when unset. */
export const profileInitials = (displayName: string | undefined): string => {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
};

/** What the profile head says before a display name exists. */
export const DISPLAY_NAME_UNSET_LABEL = 'No display name yet';

export const profileNameLabel = (displayName: string | undefined): string =>
  displayName ?? DISPLAY_NAME_UNSET_LABEL;

export const DISPLAY_NAME_MAX = 40;

export type IdentityState = 'loading' | 'ready' | 'unset' | 'offline' | 'error' | 'configuration';

export const identityErrorState = (error: unknown): IdentityState => {
  // A 404 is the normal answer for an account that has never set a name.
  if (error instanceof ApiFailure && error.status === 404) return 'unset';
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const validateDisplayName = (
  raw: string
): { ok: true; displayName: string } | { ok: false; message: string } => {
  const displayName = raw.trim().replace(/\s+/g, ' ');
  if (!displayName) return { ok: false, message: 'Enter a name your friends will recognise.' };
  if (displayName.length > DISPLAY_NAME_MAX)
    return { ok: false, message: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.` };
  return { ok: true, displayName };
};
