export type RecordingLocationPermissionState =
  'unrequested' | 'requesting' | 'precise' | 'approximate' | 'denied' | 'blocked' | 'failure';
export type LocationPermissionState = 'idle' | 'granted' | 'denied' | 'blocked';

export interface ForegroundLocationPermission {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  android?: {
    accuracy?: 'fine' | 'coarse' | 'none';
  };
}

/** Recording requires Android fine location; Explore may continue to use the broader map state. */
export const getRecordingLocationPermissionState = (
  permission: ForegroundLocationPermission
): Exclude<RecordingLocationPermissionState, 'requesting' | 'failure'> => {
  if (permission.android?.accuracy === 'fine') return 'precise';
  if (permission.android?.accuracy === 'coarse') return 'approximate';
  // Expo responses without Android accuracy metadata cannot prove a precise grant for recording.
  if (permission.status === 'granted' || permission.granted) return 'approximate';
  if (permission.status === 'undetermined') return 'unrequested';
  return permission.canAskAgain ? 'denied' : 'blocked';
};

/** Existing Explore recenter behavior accepts either coarse or fine foreground access. */
export const getLocationPermissionState = (
  permission: ForegroundLocationPermission
): 'idle' | 'granted' | 'denied' | 'blocked' => {
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
