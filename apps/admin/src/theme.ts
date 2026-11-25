/**
 * The admin's appearance (ADR-0016): light by default, dark optional, and
 * "Match device" for people who want it to follow the OS. Stored per browser.
 *
 * Framework-free so the same rules run in the pre-paint script, the switch
 * component and the tests. No colour lives here: everything visual comes from
 * the `--rs-*` variables that `@runsphere/ui` generates.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'rs-theme';
export const themePreferences: readonly ThemePreference[] = ['light', 'dark', 'system'];
export const defaultThemePreference: ThemePreference = 'light';

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && (themePreferences as readonly string[]).includes(value);

export const resolveTheme = (preference: ThemePreference, systemIsDark: boolean): ResolvedTheme =>
  preference === 'dark' || (preference === 'system' && systemIsDark) ? 'dark' : 'light';

/** Storage can throw (private windows, blocked site data), and must never stop the page. */
export const readThemePreference = (
  storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()
): ThemePreference => {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : defaultThemePreference;
  } catch {
    return defaultThemePreference;
  }
};

export const writeThemePreference = (
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()
): void => {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this visit.
  }
};

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Sets `data-theme` and the browser chrome colour. The colour is read from the token, not written here. */
export const applyTheme = (
  preference: ThemePreference,
  env: {
    root: Pick<HTMLElement, 'setAttribute'>;
    systemIsDark: boolean;
    chromeColor?: () => string;
    meta?: Pick<HTMLMetaElement, 'setAttribute'> | null;
  }
): ResolvedTheme => {
  const resolved = resolveTheme(preference, env.systemIsDark);
  env.root.setAttribute('data-theme', resolved);
  env.root.setAttribute('data-theme-preference', preference);
  const color = env.chromeColor?.();
  if (color && env.meta) env.meta.setAttribute('content', color);
  return resolved;
};

/** The browser's current environment, for callers that are not the pre-paint script. */
export const applyThemeToDocument = (preference: ThemePreference): ResolvedTheme => {
  const root = document.documentElement;
  return applyTheme(preference, {
    root,
    systemIsDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
    chromeColor: () => getComputedStyle(root).getPropertyValue('--rs-background-canvas').trim(),
    meta: document.querySelector('meta[name="theme-color"]')
  });
};
