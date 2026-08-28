export const androidPermissionAllowlist = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.INTERNET',
  'android.permission.VIBRATE'
] as const;

export const blockedAndroidPermissions = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
] as const;

export const assertAndroidPermissionBaseline = (permissions: readonly string[]): void => {
  const unexpected = permissions.filter(
    (permission) =>
      !androidPermissionAllowlist.includes(
        permission as (typeof androidPermissionAllowlist)[number]
      )
  );
  const blocked = permissions.filter((permission) =>
    blockedAndroidPermissions.includes(permission as (typeof blockedAndroidPermissions)[number])
  );
  if (unexpected.length || blocked.length) {
    throw new Error(
      `Android permission baseline violated: ${[...new Set([...unexpected, ...blocked])].join(', ')}`
    );
  }
};
