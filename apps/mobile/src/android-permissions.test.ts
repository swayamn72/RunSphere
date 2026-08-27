import { describe, expect, it } from 'vitest';
import {
  androidPermissionAllowlist,
  assertAndroidPermissionBaseline,
  blockedAndroidPermissions
} from './android-permissions.js';

describe('Android permission baseline', () => {
  it('allows only the exact M1 manifest permission set', () => {
    expect(() => assertAndroidPermissionBaseline(androidPermissionAllowlist)).not.toThrow();
  });

  it('rejects every prohibited location, overlay, and storage permission', () => {
    for (const permission of blockedAndroidPermissions) {
      expect(() =>
        assertAndroidPermissionBaseline([...androidPermissionAllowlist, permission])
      ).toThrow(permission);
    }
  });
});
