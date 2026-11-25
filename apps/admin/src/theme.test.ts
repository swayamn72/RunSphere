import { describe, expect, it } from 'vitest';
import { darkTokens, lightTokens } from '@runsphere/ui';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference
} from './theme.js';
import { themeBootstrapScript } from './theme-bootstrap.js';
import { runsphereTheme } from './theme-plugin.js';

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial ? [[THEME_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
};

describe('theme preference', () => {
  it('is light until chosen, whatever the OS prefers', () => {
    expect(readThemePreference(memory())).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('remembers a choice, and treats junk or unreadable storage as light', () => {
    const storage = memory();
    writeThemePreference('dark', storage);
    expect(readThemePreference(storage)).toBe('dark');
    expect(readThemePreference(memory('sepia'))).toBe('light');
    expect(
      readThemePreference({
        getItem: () => {
          throw new Error('blocked');
        }
      })
    ).toBe('light');
    expect(() =>
      writeThemePreference('dark', {
        setItem: () => {
          throw new Error('blocked');
        }
      })
    ).not.toThrow();
  });

  it('follows the OS only for "Match device"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('sets the theme attribute and takes the browser chrome colour from the token', () => {
    const attrs: Record<string, string> = {};
    const meta: Record<string, string> = {};
    const resolved = applyTheme('system', {
      root: { setAttribute: (name, value) => void (attrs[name] = value) },
      systemIsDark: true,
      chromeColor: () => 'token-colour',
      meta: { setAttribute: (name, value) => void (meta[name] = value) }
    });
    expect(resolved).toBe('dark');
    expect(attrs).toEqual({ 'data-theme': 'dark', 'data-theme-preference': 'system' });
    expect(meta).toEqual({ content: 'token-colour' });
  });
});

/** Runs the real pre-paint script against a fake page. */
const runBootstrap = (options: {
  stored?: string;
  systemDark?: boolean;
  storageThrows?: boolean;
}) => {
  const attrs: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const root = { setAttribute: (name: string, value: string) => void (attrs[name] = value) };
  const document = {
    documentElement: root,
    querySelector: () => ({
      setAttribute: (name: string, value: string) => void (meta[name] = value)
    })
  };
  const localStorage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error('blocked');
      return key === THEME_STORAGE_KEY ? (options.stored ?? null) : null;
    }
  };
  const window = { matchMedia: () => ({ matches: options.systemDark ?? false }) };
  const getComputedStyle = () => ({ getPropertyValue: () => ' canvas-token ' });
  new Function('document', 'localStorage', 'window', 'getComputedStyle', themeBootstrapScript())(
    document,
    localStorage,
    window,
    getComputedStyle
  );
  return { attrs, meta };
};

describe('pre-paint theme script', () => {
  it('lands on the same theme as the app for every stored value and OS setting', () => {
    for (const stored of [undefined, 'light', 'dark', 'system', 'junk'] as const)
      for (const systemDark of [true, false]) {
        const preference =
          stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
        const { attrs } = runBootstrap({ ...(stored ? { stored } : {}), systemDark });
        expect(attrs['data-theme'], `${stored} / system dark ${systemDark}`).toBe(
          resolveTheme(preference, systemDark)
        );
        expect(attrs['data-theme-preference']).toBe(preference);
      }
  });

  it('sets the browser chrome colour from the canvas token', () => {
    expect(runBootstrap({ stored: 'dark' }).meta).toEqual({ content: 'canvas-token' });
  });

  it('falls back to light when storage is blocked', () => {
    expect(runBootstrap({ storageThrows: true, systemDark: true }).attrs).toEqual({
      'data-theme': 'light'
    });
  });
});

describe('theme plugin', () => {
  it('puts the generated tokens and the script in the page head, in that order', () => {
    const plugin = runsphereTheme();
    const hook = plugin.transformIndexHtml as () => {
      tag: string;
      attrs?: Record<string, string>;
      children?: string;
      injectTo: string;
    }[];
    const tags = hook();
    expect(tags.map((tag) => tag.tag)).toEqual(['meta', 'style', 'script']);
    expect(tags[0]?.attrs?.content).toBe(lightTokens.background.canvas);
    const style = tags[1]?.children ?? '';
    expect(style).toContain(`--rs-background-canvas:${lightTokens.background.canvas}`);
    expect(style).toContain(`--rs-background-canvas:${darkTokens.background.canvas}`);
    expect(style.indexOf(':root,:root[data-theme="light"]')).toBeLessThan(
      style.indexOf(':root[data-theme="dark"]')
    );
    expect(tags[2]?.children).toContain(THEME_STORAGE_KEY);
  });
});
