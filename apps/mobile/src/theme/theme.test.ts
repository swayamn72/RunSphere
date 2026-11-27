import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPalette, contrastPairs, darkTokens, lightTokens } from '@runsphere/ui';
import {
  defaultThemePreference,
  nativeSchemeFor,
  resolveColorScheme,
  statusBarStyleFor,
  tokensFor
} from './theme-state.js';
import { gameWorld, gameWorldDay } from './game-world.js';

const luminance = (hex: string): number => {
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255
  );
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (foreground: string, background: string) => {
  const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  return (light + 0.05) / (dark + 0.05);
};

describe('light-default theme (ADR-0016)', () => {
  it('lets the app pick its own appearance on Expo, Android and iOS', () => {
    const expoConfig = readFileSync('app.config.ts', 'utf8');
    const nativeStrings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');
    const infoPlist = readFileSync('ios/TURFR/Info.plist', 'utf8');

    expect(expoConfig).toContain("userInterfaceStyle: 'automatic'");
    expect(nativeStrings).toContain(
      '<string name="expo_system_ui_user_interface_style" translatable="false">automatic</string>'
    );
    expect(infoPlist).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Automatic<\/string>/);
  });

  it('provides one complete set of roles per scheme, covering every role a screen reads', () => {
    expect(lightTokens.background.canvas).toBe(appPalette.paper);
    expect(darkTokens.background.canvas).toBe(appPalette.canvas);
    expect(darkTokens.background.surface).toBe(appPalette.panel);
    expect(darkTokens.action.primary).toBe(appPalette.accent);
    expect(darkTokens.zone.owned).toBe(appPalette.accent);
    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens.map.control).toMatch(/^#/);
      expect(tokens.route.line).toMatch(/^#/);
      expect(tokens.checkpoint.fill).toMatch(/^#/);
      expect(tokens.mascot.beacon).toMatch(/^#/);
      expect(tokens.accent.gold).toMatch(/^#/);
      expect(tokens.action.danger).toMatch(/^#/);
    }
  });

  it('is light until the runner chooses, whatever the phone is set to', () => {
    expect(defaultThemePreference).toBe('light');
    expect(resolveColorScheme(defaultThemePreference, 'dark')).toBe('light');
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });

  it('follows the phone only for "Match phone", and reads an unreported phone as light', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
    expect(resolveColorScheme('system', 'unspecified')).toBe('light');
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system')).toBe('light');
  });

  it('hands the choice to the platform, or back to the phone, in the form it expects', () => {
    expect(nativeSchemeFor('light')).toBe('light');
    expect(nativeSchemeFor('dark')).toBe('dark');
    expect(nativeSchemeFor('system')).toBe('unspecified');
    expect(statusBarStyleFor('dark')).toBe('light');
    expect(statusBarStyleFor('light')).toBe('dark');
    expect(tokensFor('light')).toBe(lightTokens);
    expect(tokensFor('dark')).toBe(darkTokens);
  });

  it('meets named critical contrast-pair minimums', () => {
    for (const pair of Object.values(contrastPairs))
      expect(contrast(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.minimum);
  });

  // The per-role AA matrix (UX.1) moved to packages/ui/src/index.test.ts, where it runs
  // over the light and dark schemes together.

  // UX.2: every colour comes from `@runsphere/ui`, so a palette change can't
  // leave a stray literal behind (which has happened twice in this codebase).
  it('has no hex colour literal outside the theme', () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'theme') walk(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/['"`]#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?['"`]/.test(readFileSync(path, 'utf8')))
            offenders.push(path);
        }
      }
    };
    walk('src');
    if (/['"`]#[0-9a-fA-F]{6}/.test(readFileSync('App.tsx', 'utf8'))) offenders.push('App.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps paper cards readable', () => {
    for (const ink of [appPalette.ink, appPalette.mutedInk])
      expect(contrast(ink, appPalette.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the Turf HUD text readable on its glass and sheets (AA)', () => {
    // The glass is ~93% opaque over a near-black basemap, so its own RGB is
    // the background a reader actually sees.
    const { hud, quest, badge, action, orb } = gameWorld;
    const pairs: [string, string, string][] = [
      ['hud text on glass', hud.text, hud.glass],
      ['hud detail on glass', hud.detail, hud.glass],
      ['status on glass', hud.status, hud.glass],
      ['sheet text', hud.text, hud.sheet],
      ['sheet helper', hud.textSoft, hud.sheet],
      ['quest glyph', quest.rim, quest.core],
      ['badge text on shield', badge.text, badge.shield],
      ['badge text on revenge', badge.text, badge.revenge],
      ['ghost action', action.ghostText, action.ghost],
      ['run orb label', orb.ink, orb.fill]
    ];
    for (const [name, foreground, background] of pairs)
      expect(contrast(foreground, background), name).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the day map HUD readable on its light glass (ADR-0017, AA)', () => {
    const { hud, map } = gameWorldDay;
    const pairs: [string, string, string][] = [
      ['hud text on glass', hud.text, hud.glass],
      ['hud detail on glass', hud.detail, hud.glass],
      ['status on glass', hud.status, hud.glass],
      ['tool on glass', hud.tool, hud.glass],
      ['sheet text', hud.text, hud.sheet],
      ['sheet helper', hud.textSoft, hud.sheet],
      ['place labels on the ground', map.label, map.night]
    ];
    for (const [name, foreground, background] of pairs)
      expect(contrast(foreground, background), name).toBeGreaterThanOrEqual(4.5);
  });

  it('draws day routes and the claim casing at 3:1 or better on the day ground', () => {
    // Lime itself is 1.14:1 on paper: this is why day routes are olive and amber-brown.
    expect(contrast(appPalette.accent, gameWorldDay.map.night)).toBeLessThan(3);
    for (const [name, colour] of Object.entries({
      quick: gameWorldDay.route.quick,
      easy: gameWorldDay.route.easy,
      loopReady: gameWorldDay.loop.ready,
      loopReturning: gameWorldDay.loop.returning,
      casing: gameWorldDay.map.casing
    }))
      expect(contrast(colour, gameWorldDay.map.night), name).toBeGreaterThanOrEqual(3);
  });

  it('keeps the brand rose for zones and a lighter rose only for text', () => {
    expect(darkTokens.zone.rival).toBe('#F43F5E');
    expect(darkTokens.text.danger).toBe('#FA6078');
    // The reason the text shade exists: brand rose on a raised card is under AA.
    expect(contrast(darkTokens.zone.rival, darkTokens.background.surfaceRaised)).toBeLessThan(4.5);
  });
});
