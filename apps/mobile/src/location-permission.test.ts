import { describe, expect, it } from 'vitest';
import { getLocationPermissionState } from './location-permission.js';

describe('foreground location permission', () => {
  it('accepts normal granted responses', () => {
    expect(
      getLocationPermissionState({ status: 'granted', granted: true, canAskAgain: true })
    ).toBe('granted');
  });

  it('accepts externally granted fine or coarse Android access even when Expo status is stale', () => {
    expect(
      getLocationPermissionState({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        android: { accuracy: 'fine' }
      })
    ).toBe('granted');
    expect(
      getLocationPermissionState({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        android: { accuracy: 'coarse' }
      })
    ).toBe('granted');
  });

  it('distinguishes retryable denial from a permanently blocked permission', () => {
    expect(
      getLocationPermissionState({ status: 'denied', granted: false, canAskAgain: true })
    ).toBe('denied');
    expect(
      getLocationPermissionState({ status: 'denied', granted: false, canAskAgain: false })
    ).toBe('blocked');
  });

  it('keeps an unrequested permission idle', () => {
    expect(
      getLocationPermissionState({ status: 'undetermined', granted: false, canAskAgain: true })
    ).toBe('idle');
  });
});
