import { describe, expect, it } from 'vitest';
import { legalLinks } from './legal-model';

describe('legal links', () => {
  it('lists the privacy notice, terms and guidelines with their addresses', () => {
    const links = legalLinks((page) => `https://api.example.in/${page}`);
    expect(links.map((link) => link.label)).toEqual([
      'Privacy notice',
      'Terms of use',
      'Community guidelines'
    ]);
    expect(links[0]?.url).toBe('https://api.example.in/privacy');
  });

  it('shows nothing when the app has no API address to link to', () => {
    expect(legalLinks(() => undefined)).toEqual([]);
  });
});
