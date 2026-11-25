import { describe, expect, it } from 'vitest';
import {
  appPalette,
  buildThemeCss,
  contrastPairs,
  contrastPairsFor,
  contrastRatio,
  darkTokens,
  fontWeight,
  lightTokens,
  radius,
  semanticTokens,
  space,
  toCssVariables,
  typeScale,
  type SemanticTokens
} from './index.js';

const schemes: [string, SemanticTokens][] = [
  ['light', lightTokens],
  ['dark', darkTokens]
];

/** The surfaces body text sits on. `paper` has its own pairs (`onPaper`). */
const readingSurfaces = (t: SemanticTokens) => [
  t.background.canvas,
  t.background.surface,
  t.background.surfaceRaised,
  t.background.surfaceInset
];

describe('design tokens', () => {
  it('exposes both schemes and keeps the dark palette values the app shipped', () => {
    expect(Object.keys(semanticTokens)).toEqual(['light', 'dark']);
    expect(darkTokens.background.canvas).toBe(appPalette.canvas);
    expect(darkTokens.action.primary).toBe(appPalette.accent);
    expect(darkTokens.zone.rival).toBe('#F43F5E');
    expect(darkTokens.text.danger).toBe('#FA6078');
  });

  it('gives every scheme the same set of roles', () => {
    const shape = (t: SemanticTokens) =>
      Object.fromEntries(Object.entries(t).map(([group, roles]) => [group, Object.keys(roles)]));
    expect(shape(lightTokens)).toEqual(shape(darkTokens));
  });

  it('keeps map-drawn roles identical in both schemes: the map is always dark', () => {
    for (const role of ['zone', 'route', 'checkpoint', 'map', 'mascot'] as const)
      expect(lightTokens[role]).toEqual(darkTokens[role]);
  });

  it('separates success from the brand lime', () => {
    expect(darkTokens.status.success).not.toBe(appPalette.accent);
    expect(lightTokens.status.success).not.toBe(appPalette.accent);
    expect(darkTokens.text.tertiary).not.toBe(darkTokens.text.secondary);
  });

  it('retires the heavy weights and keeps a modest set of scales', () => {
    expect(Object.values(fontWeight)).toEqual(['400', '500', '600', '700']);
    for (const role of Object.values(typeScale)) {
      expect(Object.keys(fontWeight)).toContain(role.weight);
      expect(role.lineHeight).toBeGreaterThanOrEqual(role.size);
    }
    // 28 distinct font sizes shipped before this scale; keep the set small.
    expect(new Set(Object.values(typeScale).map((role) => role.size)).size).toBeLessThanOrEqual(10);
    expect(radius.pill).toBe(999);
    expect(space.lg).toBe(16);
  });
});

describe('contrast (WCAG 2.2 AA)', () => {
  // The original dark-only pairs, unchanged.
  it('meets the named dark pairs the app already shipped', () => {
    for (const pair of Object.values(contrastPairs))
      expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.minimum);
  });

  it.each(schemes)('%s: named pairs pass', (_name, t) => {
    for (const [pair, { foreground, background, minimum }] of Object.entries(contrastPairsFor(t)))
      expect(contrastRatio(foreground, background), pair).toBeGreaterThanOrEqual(minimum);
  });

  /** Everything a screen sets as text. Disabled text is exempt under WCAG. */
  const textRoles = (t: SemanticTokens): Record<string, string> => ({
    'text.primary': t.text.primary,
    'text.secondary': t.text.secondary,
    'text.tertiary': t.text.tertiary,
    'text.danger': t.text.danger,
    'text.accent': t.text.accent,
    'action.primary': t.action.primary,
    'status.info': t.status.info,
    'status.success': t.status.success,
    'status.warning': t.status.warning,
    'accent.violet': t.accent.violet,
    'accent.gold': t.accent.gold
  });

  it.each(schemes)('%s: every text role is AA on every reading surface', (_name, t) => {
    for (const [role, colour] of Object.entries(textRoles(t)))
      for (const surface of readingSurfaces(t))
        expect(contrastRatio(colour, surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(schemes)('%s: borders and status graphics meet 3:1 on reading surfaces', (_name, t) => {
    for (const colour of [t.border.strong, t.border.focus, t.status.error])
      for (const surface of readingSurfaces(t))
        expect(contrastRatio(colour, surface), `${colour} on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  // The old dark matrix also held these as text on dark surfaces.
  it('dark: zone hues keep their text and graphic minimums', () => {
    const t = darkTokens;
    for (const surface of readingSurfaces(t)) {
      expect(contrastRatio(t.zone.owned, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.zone.neutral, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.zone.rival, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.route.line, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('map roles are drawn on dark, so both schemes meet 3:1 against the dark surfaces', () => {
    for (const [, t] of schemes)
      for (const colour of [t.zone.owned, t.zone.rival, t.zone.neutral, t.route.line])
        for (const surface of readingSurfaces(darkTokens))
          expect(contrastRatio(colour, surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps brand rose for zones and a lighter rose only for dark-theme text', () => {
    expect(contrastRatio(darkTokens.zone.rival, darkTokens.background.surfaceRaised)).toBeLessThan(
      4.5
    );
  });

  it('lime is a fill on light, never text', () => {
    expect(contrastRatio(appPalette.accent, lightTokens.background.canvas)).toBeLessThan(2);
    expect(lightTokens.text.accent).not.toBe(appPalette.accent);
  });
});

describe('CSS bridge', () => {
  it('flattens roles to kebab-case custom properties', () => {
    const vars = toCssVariables(lightTokens);
    expect(vars['--rs-background-canvas']).toBe(lightTokens.background.canvas);
    expect(vars['--rs-text-on-paper']).toBe(lightTokens.text.onPaper);
    expect(vars['--rs-border-paper']).toBe(lightTokens.border.paper);
    expect(vars['--rs-brand-lime']).toBe(appPalette.accent);
  });

  it('renders light as the default, dark under data-theme, and scales once', () => {
    const css = buildThemeCss();
    expect(css).toContain(':root,:root[data-theme="light"]{');
    expect(css).toContain(':root[data-theme="dark"]{');
    expect(css).toContain('--rs-type-title-size:28px');
    expect(css).toContain('--rs-radius-card:16px');
    expect(css).toContain('--rs-font-sans:Inter');
    expect(css.match(/--rs-space-lg:/g)).toHaveLength(1);
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(dark).toContain('--rs-background-canvas:#101010');
    expect(dark).toContain('--rs-shadow-e1:none');
  });
});
