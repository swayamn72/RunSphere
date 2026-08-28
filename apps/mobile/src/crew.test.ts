import { describe, expect, it } from 'vitest';
import { crewCharacters, crewCharacterMeta, crewPresentation } from './crew.js';

describe('crew mascot presentation', () => {
  it('exposes exactly the four crew members', () => {
    expect(crewCharacters).toEqual(['rho', 'mira', 'coda', 'bram']);
    expect(Object.keys(crewCharacterMeta).sort()).toEqual(['bram', 'coda', 'mira', 'rho']);
  });

  it('maps every crew member to a name and role', () => {
    for (const character of crewCharacters) {
      expect(crewCharacterMeta[character].name.length).toBeGreaterThan(0);
      expect(crewCharacterMeta[character].role.length).toBeGreaterThan(0);
    }
  });

  it('keeps decorative instances non-accessible and honours reduce motion', () => {
    const presentation = crewPresentation('rho', { mode: 'decorative' }, true);
    expect(presentation).toMatchObject({
      character: 'rho',
      accessible: false,
      reducedMotionStatic: true
    });
  });

  it('surfaces meaningful labels and rejects authority/reward/rejection phrasing', () => {
    const presentation = crewPresentation(
      'mira',
      { mode: 'meaningful', label: 'Mira is looking for the next checkpoint.' },
      false
    );
    expect(presentation.accessible).toBe(true);
    expect(presentation.accessibilityLabel).toBe('Mira is looking for the next checkpoint.');
    expect(() =>
      crewPresentation(
        'coda',
        { mode: 'meaningful', label: 'Coda says you earned a reward.' },
        false
      )
    ).toThrow('cannot claim authority');
  });
});
