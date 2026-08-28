import { describe, expect, it } from 'vitest';
import { mapProductCopy, resolveMapRenderPlan } from './map-config.js';

describe('MapSurface provider configuration', () => {
  it('uses the app-owned fallback when map configuration is absent', () => {
    expect(resolveMapRenderPlan(undefined, undefined, undefined)).toEqual({
      kind: 'fallback',
      reason: 'absent'
    });
  });

  it('passes only explicit approved HTTPS provider values to the MapSurface render plan', () => {
    expect(
      resolveMapRenderPlan(
        'https://maps.runsphere.test/styles/dark.json',
        'https://maps.runsphere.test',
        '© RunSphere Maps'
      )
    ).toEqual({
      kind: 'provider',
      provider: {
        styleUrl: 'https://maps.runsphere.test/styles/dark.json',
        attribution: '© RunSphere Maps'
      }
    });
  });

  it('rejects invalid and unapproved styles without selecting a public replacement', () => {
    expect(
      resolveMapRenderPlan(
        'http://maps.runsphere.test/style.json',
        'https://maps.runsphere.test',
        '© Maps'
      )
    ).toEqual({
      kind: 'fallback',
      reason: 'invalid'
    });
    expect(
      resolveMapRenderPlan('https://other.test/style.json', 'https://maps.runsphere.test', '© Maps')
    ).toEqual({
      kind: 'fallback',
      reason: 'rejected-origin'
    });
  });

  it('does not accept product identifiers or local geometry as MapSurface render-plan inputs', () => {
    expect(resolveMapRenderPlan).toHaveLength(3);
    expect(resolveMapRenderPlan.toString()).not.toMatch(
      /account|activity|checkpoint|route|header|query/i
    );
  });

  it('keeps fallback copy plain and product-owned', () => {
    expect(mapProductCopy('offline')).toBe('Offline map view');
    expect(mapProductCopy('unavailable')).toBe('Map details unavailable');
  });
});
