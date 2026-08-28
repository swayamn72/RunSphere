import { useEffect, useMemo, useState, createContext, useContext } from 'react';
import type React from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { darkTokens, lightTokens, type SemanticTokens } from '@runsphere/ui';
import { resolveColorScheme, type AppColorScheme } from './theme-state';

export type { AppColorScheme } from './theme-state';

export interface ThemeValue {
  readonly colorScheme: AppColorScheme;
  readonly tokens: SemanticTokens;
  readonly reduceMotion: boolean;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);

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

  const colorScheme = resolveColorScheme(systemScheme);
  const value = useMemo<ThemeValue>(
    () => ({
      colorScheme,
      tokens: colorScheme === 'dark' ? darkTokens : lightTokens,
      reduceMotion
    }),
    [colorScheme, reduceMotion]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useAppTheme = (): ThemeValue => {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useAppTheme must be used within ThemeProvider.');
  return theme;
};
