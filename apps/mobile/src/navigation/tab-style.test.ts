import { describe, expect, it } from 'vitest';
import { contrastPairs, darkTokens, lightTokens } from '@runsphere/ui';
import { tabEmphasis } from './tab-style.js';
import { tabs } from './types.js';

describe('five-tab foundation', () => {
  it('preserves the product tab order and quiet visual emphasis without disabling tabs', () => {
    expect(tabs).toEqual(['Home', 'Explore', 'Season', 'Clubs', 'You']);
    expect(tabEmphasis('Home')).toBe('primary');
    expect(tabEmphasis('Explore')).toBe('primary');
    expect(tabEmphasis('You')).toBe('primary');
    expect(tabEmphasis('Season')).toBe('quiet');
    expect(tabEmphasis('Clubs')).toBe('quiet');
  });

  it('uses a contrast-safe tertiary token rather than disabled text for quiet tabs', () => {
    expect(darkTokens.text.tertiary).not.toBe(darkTokens.text.disabled);
    expect(lightTokens.text.tertiary).not.toBe(lightTokens.text.disabled);
    expect(contrastPairs.darkTertiaryTab.foreground).toBe(darkTokens.text.tertiary);
    expect(contrastPairs.lightTertiaryTab.foreground).toBe(lightTokens.text.tertiary);
  });
});
