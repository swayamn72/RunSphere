import { describe, expect, it } from 'vitest';
import {
  ageOn,
  isAdult,
  isHomeArea,
  normalizeUsername,
  usernameProblem,
  usernameSeed
} from './social-identity.js';

describe('usernames (ADR-0014)', () => {
  it('normalizes a typed name: trims, drops a leading @, lowercases', () => {
    expect(normalizeUsername('  @Swayam_Runs ')).toBe('swayam_runs');
  });

  it('accepts 3–20 letters, digits and _, starting with a letter', () => {
    expect(usernameProblem('swayam_runs')).toBeUndefined();
    expect(usernameProblem('ab')).toBe('format');
    expect(usernameProblem('9lives')).toBe('format');
    expect(usernameProblem('has space')).toBe('format');
    expect(usernameProblem('a'.repeat(21))).toBe('format');
  });

  it('keeps product, staff and crew names for the product', () => {
    expect(usernameProblem('admin')).toBe('reserved');
    expect(usernameProblem('rho')).toBe('reserved');
    expect(usernameProblem('runsphere_team')).toBe('reserved');
    expect(usernameProblem('support')).toBe('reserved');
  });

  it('refuses names containing slurs, wherever they appear', () => {
    expect(usernameProblem('xx_fuck_xx')).toBe('not_allowed');
  });

  it('suggests a valid seed from any display name', () => {
    expect(usernameSeed('Swayam N')).toBe('swayam_n');
    expect(usernameSeed('42')).toBe('runner');
    expect(usernameSeed('Ré')).toBe('runnerre');
    for (const name of ['Swayam N', '42', 'Ré', '  ', 'Admin'])
      expect(usernameProblem(usernameSeed(name))).toBeUndefined();
  });
});

describe('the adult-only age check (ADR-0014)', () => {
  it('counts whole years, with the birthday itself counting', () => {
    expect(ageOn('2008-11-21', '2026-11-21')).toBe(18);
    expect(ageOn('2008-11-22', '2026-11-21')).toBe(17);
    expect(isAdult('2008-11-21', '2026-11-21')).toBe(true);
    expect(isAdult('2008-11-22', '2026-11-21')).toBe(false);
  });

  it('refuses dates that are not real or are in the future', () => {
    expect(ageOn('2001-02-29', '2026-11-21')).toBeUndefined();
    expect(ageOn('2030-01-01', '2026-11-21')).toBeUndefined();
    expect(ageOn('21-11-2001', '2026-11-21')).toBeUndefined();
    expect(isAdult('1890-01-01', '2026-11-21')).toBe(false);
  });

  it('handles a 29 February birthday in a non-leap year', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('home areas', () => {
  it('accepts only names from the list, never free text', () => {
    expect(isHomeArea('Bandra West')).toBe(true);
    expect(isHomeArea('14 Hill Road, Bandra')).toBe(false);
  });
});
