import { describe, expect, it } from 'vitest';
import {
  getLocationPermissionState,
  getRecordingLocationPermissionState
} from './location-permission.js';

describe('foreground location permission', () => {
  it('requires precise Android access for recording', () => {
    expect(
      getRecordingLocationPermissionState({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        android: { accuracy: 'fine' }
      })
    ).toBe('precise');
    expect(
      getRecordingLocationPermissionState({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        android: { accuracy: 'coarse' }
      })
    ).toBe('approximate');
  });

  it('does not treat a granted response without Android precision metadata as precise', () => {
    expect(
      getRecordingLocationPermissionState({ status: 'granted', granted: true, canAskAgain: true })
    ).toBe('approximate');
  });

  it('classifies unrequested, askable denial, and blocked states distinctly', () => {
    expect(
      getRecordingLocationPermissionState({
        status: 'undetermined',
        granted: false,
        canAskAgain: true
      })
    ).toBe('unrequested');
    expect(
      getRecordingLocationPermissionState({ status: 'denied', granted: false, canAskAgain: true })
    ).toBe('denied');
    expect(
      getRecordingLocationPermissionState({ status: 'denied', granted: false, canAskAgain: false })
    ).toBe('blocked');
  });

  it('preserves broader coarse-or-fine access for Explore recentering', () => {
    expect(
      getLocationPermissionState({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        android: { accuracy: 'coarse' }
      })
    ).toBe('granted');
  });
});
