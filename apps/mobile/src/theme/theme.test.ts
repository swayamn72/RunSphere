import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastPairs, darkTokens } from '@runsphere/ui';
import { resolveColorScheme } from './theme-state.js';

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
    expect(darkTokens.background.canvas).toMatch(/^#/);
    expect(darkTokens.map.control).toMatch(/^#/);
    expect(darkTokens.route.line).toMatch(/^#/);
    expect(darkTokens.checkpoint.fill).toMatch(/^#/);
    expect(darkTokens.mascot.beacon).toMatch(/^#/);
    // The named hues the redesign leans on: zone ownership and reward tiers.
    expect(darkTokens.zone.owned).toMatch(/^#/);
    expect(darkTokens.zone.rival).toMatch(/^#/);
    expect(darkTokens.zone.neutral).toMatch(/^#/);
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
});
