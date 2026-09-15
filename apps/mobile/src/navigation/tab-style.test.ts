import { describe, expect, it } from 'vitest';
import { contrastPairs, darkTokens } from '@runsphere/ui';
import { tabEmphasis, tabIcons } from './tab-style.js';
import { landingTab, tabs } from './types.js';

describe('five-tab foundation', () => {
  it('keeps the product tab order with Run in the centre', () => {
    expect(tabs).toEqual(['Home', 'Map', 'Run', 'Social', 'Profile']);
    // Run is the one destination reached mid-stride, so it owns the middle
    // position the thumb finds without looking.
    expect(tabs[2]).toBe('Run');
    expect(landingTab).toBe('Home');
    expect(tabs).toContain(landingTab);
  });

  it('renders every tab at full emphasis now that each leads to real data', () => {
    for (const tab of tabs) expect(tabEmphasis(tab)).toBe('primary');
  });

  it('gives every tab a distinct icon so the bar never renders a shared or missing glyph', () => {
    const icons = tabs.map((tab) => tabIcons[tab]);
    expect(icons.every((icon) => icon.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(tabs.length);
    expect(Object.keys(tabIcons)).toHaveLength(tabs.length);
  });

  it('uses a contrast-safe tertiary token rather than disabled text for quiet tabs', () => {
    expect(darkTokens.text.tertiary).not.toBe(darkTokens.text.disabled);
    expect(contrastPairs.tertiaryTab.foreground).toBe(darkTokens.text.tertiary);
  });
});
