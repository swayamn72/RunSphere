import { describe, expect, it } from 'vitest';
import { contrastPairs, darkTokens, lightTokens } from '@runsphere/ui';
import { tabEmphasis, tabIcons } from './tab-style.js';
import { landingTab, tabs } from './types.js';

describe('six-tab foundation', () => {
  it('preserves the product tab order and quiet visual emphasis without disabling tabs', () => {
    // Turf leads: it is the surface people open to see what changed while they
    // were away, and `screens.md` requires the map itself to be the first view
    // rather than a dashboard or a splash (ADR-0011).
    expect(tabs).toEqual(['Turf', 'Home', 'Explore', 'Play', 'Clubs', 'You']);
    expect(tabs[0]).toBe(landingTab);
    expect(tabEmphasis('Home')).toBe('primary');
    expect(tabEmphasis('Explore')).toBe('primary');
    expect(tabEmphasis('Turf')).toBe('primary');
    expect(tabEmphasis('You')).toBe('primary');
    // Play carries real challenges and standings as of milestone 2.4;
    // Clubs is still a truthful future-state screen.
    expect(tabEmphasis('Play')).toBe('primary');
    expect(tabEmphasis('Clubs')).toBe('quiet');
  });

  it('gives every tab a distinct icon so the bar never renders a shared or missing glyph', () => {
    const icons = tabs.map((tab) => tabIcons[tab]);
    expect(icons.every((icon) => icon.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(tabs.length);
    expect(Object.keys(tabIcons)).toHaveLength(tabs.length);
  });

  it('uses a contrast-safe tertiary token rather than disabled text for quiet tabs', () => {
    expect(darkTokens.text.tertiary).not.toBe(darkTokens.text.disabled);
    expect(lightTokens.text.tertiary).not.toBe(lightTokens.text.disabled);
    expect(contrastPairs.darkTertiaryTab.foreground).toBe(darkTokens.text.tertiary);
    expect(contrastPairs.lightTertiaryTab.foreground).toBe(lightTokens.text.tertiary);
  });
});
