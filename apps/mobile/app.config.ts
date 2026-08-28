import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'RunSphere',
  slug: 'runsphere',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  android: {
    package: 'com.runsphere.app',
    allowBackup: false,
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.INTERNET',
      'android.permission.VIBRATE'
    ],
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE'
    ]
  },
  ios: {
    bundleIdentifier: 'com.runsphere.app'
  },
  plugins: [
    'expo-secure-store',
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow RunSphere to use your location while you record an activity.',
        locationAlwaysAndWhenInUsePermission:
          'Allow RunSphere to record your activity while the screen is locked. This is requested only when you start recording.'
      }
    ],
    [
      'expo-sensors',
      {
        motionPermission:
          'Allow RunSphere to access motion and fitness data to improve activity estimates.'
      }
    ]
  ],
  experiments: {
    typedRoutes: false
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
  }
};

export default config;
