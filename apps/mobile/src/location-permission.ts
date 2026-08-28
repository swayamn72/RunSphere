export type LocationPermissionState = 'idle' | 'granted' | 'denied' | 'blocked';

export interface ForegroundLocationPermission {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  android?: {
    accuracy?: 'fine' | 'coarse' | 'none';
  };
}

/**
 * Expo derives Android foreground status from coarse permission. A fine-only grant (for example,
 * one applied by device policy or ADB) is still usable by the native location module, so accuracy
 * must also be considered when reconciling permission state.
 */
export const getLocationPermissionState = (
  permission: ForegroundLocationPermission
): LocationPermissionState => {
  if (
    permission.granted ||
    permission.status === 'granted' ||
    permission.android?.accuracy === 'fine' ||
    permission.android?.accuracy === 'coarse'
  )
    return 'granted';

  if (permission.status === 'undetermined') return 'idle';
  return permission.canAskAgain ? 'denied' : 'blocked';
};
