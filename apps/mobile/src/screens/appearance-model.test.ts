import { describe, expect, it } from 'vitest';
import { APPEARANCE_OPTIONS, appearanceHint } from './appearance-model';

describe('appearance choices', () => {
  it('offers Light, Dark and Match phone, in that order', () => {
    expect(APPEARANCE_OPTIONS.map((option) => option.value)).toEqual(['light', 'dark', 'system']);
    expect(APPEARANCE_OPTIONS.map((option) => option.label)).toEqual([
      'Light',
      'Dark',
      'Match phone'
    ]);
  });

  it('always says the map and the live run stay dark, and when the phone decides', () => {
    expect(appearanceHint('light')).toMatch(/always stay dark/);
    expect(appearanceHint('dark')).toMatch(/always stay dark/);
    expect(appearanceHint('system')).toMatch(/follows your phone/);
  });
});
