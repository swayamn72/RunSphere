import type { ThemePreference } from '../theme/theme-state';

/** The three choices, in the order they are shown. Words follow `docs/voice.md`. */
export const APPEARANCE_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match phone' }
];

/** One line under the choices: what the current pick does, and what never changes. */
export const appearanceHint = (preference: ThemePreference): string =>
  preference === 'system'
    ? 'TURFR follows your phone. The Turf map and your live run always stay dark.'
    : 'The Turf map and your live run always stay dark.';
