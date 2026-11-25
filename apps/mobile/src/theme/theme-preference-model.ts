import { defaultThemePreference, isThemePreference, type ThemePreference } from './theme-state';

const KEY = 'turfr.theme-preference.v1';

/** The slice of expo-secure-store this needs, so tests can pass a fake. */
export interface PreferenceStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export interface ThemePreferenceStore {
  load(): Promise<ThemePreference>;
  save(preference: ThemePreference): Promise<void>;
}

/**
 * One device-level setting, not per account: how the phone looks doesn't change
 * when somebody else signs in. A missing, unreadable or unknown value is the
 * default, because a theme must never be the reason the app doesn't open.
 */
export const createThemePreferenceStore = (storage: PreferenceStorage): ThemePreferenceStore => ({
  async load() {
    try {
      const stored = await storage.getItemAsync(KEY);
      return isThemePreference(stored) ? stored : defaultThemePreference;
    } catch {
      return defaultThemePreference;
    }
  },
  async save(preference) {
    await storage.setItemAsync(KEY, preference);
  }
});
