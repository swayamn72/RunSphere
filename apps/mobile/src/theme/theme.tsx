import { useCallback, useEffect, useMemo, useState, createContext, useContext } from 'react';
import type React from 'react';
import { AccessibilityInfo, Appearance, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { darkTokens, type SemanticTokens } from '@runsphere/ui';
import {
  defaultThemePreference,
  nativeSchemeFor,
  resolveColorScheme,
  statusBarStyleFor,
  tokensFor,
  type AppColorScheme,
  type ThemePreference
} from './theme-state';
import type { ThemePreferenceStore } from './theme-preference-model';
import { loadInterFonts } from './inter-fonts';

export type { AppColorScheme, ThemePreference } from './theme-state';

export interface ThemeValue {
  readonly colorScheme: AppColorScheme;
  readonly tokens: SemanticTokens;
  readonly reduceMotion: boolean;
  /** What the runner picked; `colorScheme` is what that resolves to now. */
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
  /** False until Inter is registered, or for good if it could not be. */
  readonly fontsReady: boolean;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * Holds the appearance for the whole app: the saved preference (light until the
 * runner chooses), the phone's setting for "Match phone", and whether Inter is
 * ready. Children are not drawn until the preference and the fonts have
 * settled, so a runner who chose dark never sees a light frame first. The wait
 * is the splash screen's, so it is invisible in practice.
 */
export function ThemeProvider({
  children,
  store
}: {
  children: React.ReactNode;
  store?: ThemePreferenceStore;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [preference, setPreferenceState] = useState<ThemePreference>(defaultThemePreference);
  const [fontsReady, setFontsReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      active = false;
      motionSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      store ? store.load() : Promise.resolve(defaultThemePreference),
      loadInterFonts()
    ])
      .then(([saved, loaded]) => {
        if (!active) return;
        setPreferenceState(saved);
        setFontsReady(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSettled(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  // Native pickers, the keyboard and system dialogs follow the app's choice,
  // not the phone's, unless the runner chose "Match phone".
  useEffect(() => {
    Appearance.setColorScheme(nativeSchemeFor(preference));
  }, [preference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      // Best effort: the change applies now even if it can't be saved.
      void store?.save(next).catch(() => undefined);
    },
    [store]
  );

  const colorScheme = resolveColorScheme(preference, systemScheme);
  const value = useMemo<ThemeValue>(
    () => ({
      colorScheme,
      tokens: tokensFor(colorScheme),
      reduceMotion,
      preference,
      setPreference,
      fontsReady
    }),
    [colorScheme, reduceMotion, preference, setPreference, fontsReady]
  );

  if (!settled) return <View style={{ flex: 1, backgroundColor: darkTokens.background.canvas }} />;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useAppTheme = (): ThemeValue => {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useAppTheme must be used within ThemeProvider.');
  return theme;
};

/**
 * Draws its children in one scheme whatever the app is set to. The Turf map and
 * the live run are designed for night, so they are drawn under this with `dark`
 * (ADR-0016). With no `scheme` it passes the app's own through, so it can stay
 * mounted as the runner moves on and off those surfaces without remounting the
 * map. It also owns the status bar for whatever it covers.
 */
export function ForceTheme({
  scheme,
  children
}: {
  scheme?: AppColorScheme;
  children: React.ReactNode;
}) {
  const parent = useAppTheme();
  const resolved = scheme ?? parent.colorScheme;
  const value = useMemo<ThemeValue>(
    () => ({ ...parent, colorScheme: resolved, tokens: tokensFor(resolved) }),
    [parent, resolved]
  );
  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={statusBarStyleFor(resolved)} />
      {children}
    </ThemeContext.Provider>
  );
}
