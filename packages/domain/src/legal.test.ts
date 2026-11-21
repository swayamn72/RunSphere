import { describe, expect, it } from 'vitest';
import { isDraftPolicy, legalPageUrl } from './legal.js';

describe('legal pages', () => {
  it('builds page addresses under the API origin, with or without a trailing slash', () => {
    expect(legalPageUrl('https://api.example.in', 'privacy')).toBe(
      'https://api.example.in/privacy'
    );
    expect(legalPageUrl('https://api.example.in/', 'communityGuidelines')).toBe(
      'https://api.example.in/community-guidelines'
    );
  });

  it('marks the text as a draft until a lawyer has approved it', () => {
    expect(isDraftPolicy('2026-11-22-draft')).toBe(true);
    expect(isDraftPolicy('2027-01-15')).toBe(false);
  });
});
