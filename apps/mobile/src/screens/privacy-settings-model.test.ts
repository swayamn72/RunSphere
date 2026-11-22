import { describe, expect, it } from 'vitest';
import type { PrivacySettings } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import {
  AUDIENCE_OPTIONS,
  NEVER_SHARED,
  PROFILE_HELP,
  REQUESTS_FROM_OPTIONS,
  TOGGLES,
  applyChange,
  saveFailureMessage,
  usernameHint
} from './privacy-settings-model';

const settings: PrivacySettings = {
  profileVisibility: 'everyone',
  searchable: true,
  friendRequestsFrom: 'everyone',
  runsVisibility: 'friends',
  showRouteMaps: true,
  showStartTimes: false,
  trimStartFinish: true,
  nameOnGround: true,
  drawGround: true,
  friendBoard: true,
  ghostRaces: true,
  reviewed: false
};

describe('privacy settings screen (SI.5)', () => {
  it('covers every server control exactly once', () => {
    const toggles = Object.values(TOGGLES)
      .flat()
      .map((toggle) => toggle.key);
    const choices = ['profileVisibility', 'runsVisibility', 'friendRequestsFrom'];
    const controlled = new Set([...toggles, ...choices]);
    const serverKeys = Object.keys(settings).filter((key) => key !== 'reviewed');
    expect([...controlled].sort()).toEqual(serverKeys.sort());
    expect(toggles).toHaveLength(new Set(toggles).size);
  });

  it('offers the three audiences and three request options', () => {
    expect(AUDIENCE_OPTIONS.map((option) => option.label)).toEqual([
      'Everyone',
      'Friends',
      'Only me'
    ]);
    expect(REQUESTS_FROM_OPTIONS.map((option) => option.value)).toEqual([
      'everyone',
      'friends_of_friends',
      'nobody'
    ]);
    expect(PROFILE_HELP.only_me).toMatch(/Nobody/);
  });

  it('says what is never shared', () => {
    expect(NEVER_SHARED).toMatch(/live location/);
    expect(NEVER_SHARED).toMatch(/date of birth/);
    // Start and finish may be shown since ADR-0015, so this mustn't promise otherwise.
    expect(NEVER_SHARED).not.toMatch(/start and finish/);
  });

  it('applies a change locally before the server answers', () => {
    expect(applyChange(settings, { ghostRaces: false }).ghostRaces).toBe(false);
  });

  it('keeps failures plain and says the old setting is kept', () => {
    expect(saveFailureMessage(new ApiFailure(500, 'Request to /v1/x failed (500).'))).not.toMatch(
      /\/v1\//
    );
    expect(saveFailureMessage(new Error('x'))).toMatch(/previous setting is kept/);
  });

  it('hints at username rules while typing', () => {
    expect(usernameHint('')).toBeUndefined();
    expect(usernameHint('9x')).toBe('Start with a letter.');
    expect(usernameHint('ab')).toBe('At least 3 characters.');
    expect(usernameHint('a b c')).toBe('Use letters, numbers and _ only.');
    expect(usernameHint('@Swayam_runs')).toBeUndefined();
  });
});
