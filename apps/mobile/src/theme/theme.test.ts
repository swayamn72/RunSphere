import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastPairs, darkTokens, lightTokens } from '@runsphere/ui';
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

describe('system theme', () => {
  it('keeps Expo and the committed Android project configured to follow the system', () => {
    const expoConfig = readFileSync('app.config.ts', 'utf8');
    const nativeStrings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');

    expect(expoConfig).toContain("userInterfaceStyle: 'automatic'");
    expect(nativeStrings).toContain(
      '<string name="expo_system_ui_user_interface_style" translatable="false">automatic</string>'
    );
  });

  it('provides complete explicit dark and light semantic systems', () => {
    for (const tokens of [darkTokens, lightTokens]) {
      expect(tokens.background.canvas).toMatch(/^#/);
      expect(tokens.map.control).toMatch(/^#/);
      expect(tokens.route.line).toMatch(/^#/);
      expect(tokens.checkpoint.fill).toMatch(/^#/);
      expect(tokens.mascot.beacon).toMatch(/^#/);
    }
    expect(darkTokens.background.canvas).not.toBe(lightTokens.background.canvas);
    expect(contrastPairs.darkPrimaryText.foreground).toBe(darkTokens.text.primary);
    expect(contrastPairs.lightPrimaryText.background).toBe(lightTokens.background.surface);
  });

  it('selects system light and keeps unknown system appearance dark-first', () => {
    expect(resolveColorScheme('light')).toBe('light');
    expect(resolveColorScheme('dark')).toBe('dark');
    expect(resolveColorScheme(null)).toBe('dark');
  });

  it('meets named critical contrast-pair minimums', () => {
    for (const pair of Object.values(contrastPairs))
      expect(contrast(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.minimum);
  });
});
