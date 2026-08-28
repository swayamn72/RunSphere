import { describe, expect, it } from 'vitest';
import { isSafeMascotLabel, mascotPresentation, mascotVariants } from './mascot.js';

describe('Loop mascot presentation', () => {
  it('only exposes approved static guide variants', () => {
    expect(mascotVariants).toEqual([
      'home',
      'loading',
      'empty',
      'gps-recovery',
      'offline',
      'pending'
    ]);
    const presentation = mascotPresentation('offline', { mode: 'decorative' }, true);
    expect(presentation).toMatchObject({
      animated: false,
      reducedMotionStatic: true,
      accessible: false
    });
  });

  it('makes meaningful state guidance accessible without duplicating decorative art', () => {
    expect(
      mascotPresentation(
        'gps-recovery',
        { mode: 'meaningful', label: 'Loop is waiting for a clearer GPS signal.' },
        false
      )
    ).toMatchObject({
      accessible: true,
      accessibilityLabel: 'Loop is waiting for a clearer GPS signal.'
    });
  });

  it('rejects authority, reward, and rejection labels at the presentation boundary', () => {
    expect(isSafeMascotLabel('Loop is here while your activity is processing.')).toBe(true);
    expect(isSafeMascotLabel('Loop says your activity is validated.')).toBe(false);
    expect(isSafeMascotLabel('You earned a reward with Loop.')).toBe(false);
    expect(isSafeMascotLabel('Loop celebrates a rejected activity.')).toBe(false);
    expect(() =>
      mascotPresentation(
        'pending',
        { mode: 'meaningful', label: 'Loop says this is validated.' },
        false
      )
    ).toThrow('cannot claim authority');
  });
});
