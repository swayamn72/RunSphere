import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'RunSphere',
  slug: 'runsphere',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  android: {
    package: 'com.runsphere.app',
    allowBackup: false,
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.INTERNET',
      'android.permission.VIBRATE'
    ],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
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
    'expo-sqlite',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow RunSphere to use your location while you use the app to map activities and nearby quests.'
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
