import { semanticTokens, type SemanticTokens } from '@runsphere/ui';

/** What is on screen. Light is the default appearance (ADR-0016). */
export type AppColorScheme = 'light' | 'dark';

/** What the runner picked. `system` follows the phone. */
export type ThemePreference = AppColorScheme | 'system';

export const themePreferences: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** A runner who has never chosen gets light, whatever the phone is set to. */
export const defaultThemePreference: ThemePreference = 'light';

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && (themePreferences as readonly string[]).includes(value);

/**
 * Turns a preference into the scheme to draw. Only `system` consults the phone,
 * and an unreported phone setting reads as light, the default.
 */
export const resolveColorScheme = (
  preference: ThemePreference,
  system?: 'light' | 'dark' | 'unspecified' | null
): AppColorScheme => {
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
};

export const tokensFor = (scheme: AppColorScheme): SemanticTokens => semanticTokens[scheme];

/** Light icons on a dark canvas and the reverse. */
export const statusBarStyleFor = (scheme: AppColorScheme): 'light' | 'dark' =>
  scheme === 'dark' ? 'light' : 'dark';

/** The value `Appearance.setColorScheme` takes: `unspecified` hands control back to the phone. */
export const nativeSchemeFor = (preference: ThemePreference): AppColorScheme | 'unspecified' =>
  preference === 'system' ? 'unspecified' : preference;
