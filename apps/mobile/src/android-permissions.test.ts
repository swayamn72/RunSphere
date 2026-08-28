import { describe, expect, it } from 'vitest';
import {
  androidPermissionAllowlist,
  assertAndroidPermissionBaseline,
  blockedAndroidPermissions
} from './android-permissions.js';

describe('Android permission baseline', () => {
  it('allows only the exact M2 foreground recording manifest permission set', () => {
    expect(() => assertAndroidPermissionBaseline(androidPermissionAllowlist)).not.toThrow();
  });

  it('rejects prohibited overlay and storage permissions', () => {
    for (const permission of blockedAndroidPermissions) {
      expect(() =>
        assertAndroidPermissionBaseline([...androidPermissionAllowlist, permission])
      ).toThrow(permission);
    }
  });
});
