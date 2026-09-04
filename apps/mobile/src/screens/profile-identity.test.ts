import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';
import {
  DISPLAY_NAME_UNSET_LABEL,
  identityErrorState,
  profileInitials,
  profileNameLabel,
  validateDisplayName
} from './profile-model';

describe('display name validation', () => {
  it('trims and collapses whitespace', () => {
    expect(validateDisplayName('  Maya   Hart ')).toEqual({ ok: true, displayName: 'Maya Hart' });
  });

  it('requires something a friend can recognise', () => {
    expect(validateDisplayName('')).toMatchObject({ ok: false });
    expect(validateDisplayName('   ')).toMatchObject({ ok: false });
  });

  it('holds to the 40-character contract limit', () => {
    expect(validateDisplayName('a'.repeat(40))).toMatchObject({ ok: true });
    expect(validateDisplayName('a'.repeat(41))).toMatchObject({ ok: false });
  });
});

describe('identity state', () => {
  it('treats a 404 as an account that has never set a name, not as an error', () => {
    expect(identityErrorState(new ApiFailure(404, 'Profile not found'))).toBe('unset');
  });

  it('maps transport failures the way every other screen does', () => {
    expect(identityErrorState(new AuthFailure('network'))).toBe('offline');
    expect(identityErrorState(new AuthFailure('tls'))).toBe('offline');
    expect(identityErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(identityErrorState(new Error('boom'))).toBe('error');
  });
});

describe('profile initials', () => {
  it('uses the account own name, at most two letters', () => {
    expect(profileInitials('Maya Hart')).toBe('MH');
    expect(profileInitials('Maya')).toBe('M');
    expect(profileInitials('maya anne hart')).toBe('MA');
  });

  it('shows a neutral mark rather than inventing a person', () => {
    expect(profileInitials(undefined)).toBe('—');
    expect(profileInitials('   ')).toBe('—');
  });

  it('handles a name that starts outside the Latin alphabet', () => {
    expect(profileInitials('अनिता शर्मा')).toBe('अश');
  });

  it('names the unset state instead of leaving the head blank', () => {
    expect(profileNameLabel(undefined)).toBe(DISPLAY_NAME_UNSET_LABEL);
    expect(profileNameLabel('Maya')).toBe('Maya');
  });
});
