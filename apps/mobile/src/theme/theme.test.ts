import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPalette, contrastPairs, darkTokens } from '@runsphere/ui';
import { resolveColorScheme } from './theme-state.js';
import { gameWorld } from './game-world.js';

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

describe('single-appearance theme', () => {
  it('pins Expo and the committed Android project to the one appearance the product ships', () => {
    const expoConfig = readFileSync('app.config.ts', 'utf8');
    const nativeStrings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');

    expect(expoConfig).toContain("userInterfaceStyle: 'dark'");
    expect(nativeStrings).toContain(
      '<string name="expo_system_ui_user_interface_style" translatable="false">dark</string>'
    );
  });

  it('provides one complete semantic system covering every role a screen reads', () => {
    expect(darkTokens.background.canvas).toBe(appPalette.canvas);
    expect(darkTokens.background.surface).toBe(appPalette.panel);
    expect(darkTokens.action.primary).toBe(appPalette.accent);
    expect(darkTokens.map.control).toMatch(/^#/);
    expect(darkTokens.route.line).toMatch(/^#/);
    expect(darkTokens.checkpoint.fill).toMatch(/^#/);
    expect(darkTokens.mascot.beacon).toMatch(/^#/);
    // The named hues the redesign leans on: zone ownership and reward tiers.
    expect(darkTokens.zone.owned).toBe(appPalette.accent);
    expect(darkTokens.zone.rival).toBe('#F43F5E');
    expect(darkTokens.zone.neutral).toBe('#F59E0B');
    expect(darkTokens.accent.gold).toMatch(/^#/);
    expect(darkTokens.action.danger).toMatch(/^#/);
  });

  it('ignores the platform appearance rather than inverting the product at runtime', () => {
    expect(resolveColorScheme('light')).toBe('dark');
    expect(resolveColorScheme('dark')).toBe('dark');
    expect(resolveColorScheme(null)).toBe('dark');
    expect(resolveColorScheme()).toBe('dark');
  });

  it('meets named critical contrast-pair minimums', () => {
    for (const pair of Object.values(contrastPairs))
      expect(contrast(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.minimum);
  });

  /**
   * UX.1 (Milestone 2.5): every colour a screen may set as *text* meets WCAG
   * 2.2 AA (4.5:1) on every surface it can sit on, and every colour used for
   * map zones, lines and glyphs meets the 3:1 non-text minimum. Disabled text
   * is exempt under WCAG. `action.danger` is a button fill, not a text colour,
   * so it is covered by the white-on-danger pair above instead.
   */
  const surfaces = Object.entries(darkTokens.background);
  const textRoles = {
    'text.primary': darkTokens.text.primary,
    'text.secondary': darkTokens.text.secondary,
    'text.tertiary': darkTokens.text.tertiary,
    'text.danger': darkTokens.text.danger,
    'action.primary': darkTokens.action.primary,
    'status.info': darkTokens.status.info,
    'status.success': darkTokens.status.success,
    'status.warning': darkTokens.status.warning,
    'accent.violet': darkTokens.accent.violet,
    'accent.gold': darkTokens.accent.gold,
    'zone.owned': darkTokens.zone.owned,
    'zone.neutral': darkTokens.zone.neutral
  };
  const graphicRoles = {
    'zone.owned': darkTokens.zone.owned,
    'zone.rival': darkTokens.zone.rival,
    'zone.neutral': darkTokens.zone.neutral,
    'status.error': darkTokens.status.error,
    'route.line': darkTokens.route.line,
    'border.focus': darkTokens.border.focus
  };

  it.each(Object.entries(textRoles))('%s is AA text on every surface', (_role, colour) => {
    for (const [, surface] of surfaces)
      expect(contrast(colour, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(graphicRoles))(
    '%s meets 3:1 as a graphic on every surface',
    (_role, colour) => {
      for (const [, surface] of surfaces)
        expect(contrast(colour, surface)).toBeGreaterThanOrEqual(3);
    }
  );

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

  it('keeps the brand rose for zones and a lighter rose only for text', () => {
    expect(darkTokens.zone.rival).toBe('#F43F5E');
    expect(darkTokens.text.danger).toBe('#FA6078');
    // The reason the text shade exists: brand rose on a raised card is under AA.
    expect(contrast(darkTokens.zone.rival, darkTokens.background.surfaceRaised)).toBeLessThan(4.5);
  });
});
