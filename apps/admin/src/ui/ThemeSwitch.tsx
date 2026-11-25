import { useEffect, useState } from 'react';
import {
  applyThemeToDocument,
  readThemePreference,
  themePreferences,
  writeThemePreference,
  type ThemePreference
} from '../theme.js';

export const THEME_LABEL: Readonly<Record<ThemePreference, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match device'
};

/** The saved preference and a setter that applies it at once. Shared by every theme control. */
export function useThemePreference(): readonly [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());

  // "Match device" has to follow the OS if it changes while the page is open.
  useEffect(() => {
    if (preference !== 'system' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeToDocument('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    writeThemePreference(next);
    applyThemeToDocument(next);
  };
  return [preference, choose] as const;
}

/** Light, Dark or Match device. Applies at once and is remembered in this browser. */
export function ThemeSwitch() {
  const [preference, choose] = useThemePreference();
  return (
    <div className="rs-segmented" role="radiogroup" aria-label="Appearance">
      {themePreferences.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={preference === option}
          className="rs-segmented__option"
          onClick={() => choose(option)}
        >
          {THEME_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
