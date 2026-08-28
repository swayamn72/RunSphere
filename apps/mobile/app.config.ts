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
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.VIBRATE'
    ],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
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
    ],
    ['@maplibre/maplibre-react-native', { android: { nativeVariant: 'opengl' } }]
  ],
  experiments: {
    typedRoutes: false
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? '',
    mapStyleOrigins: process.env.EXPO_PUBLIC_MAP_STYLE_ORIGINS ?? '',
    mapAttribution: process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? ''
  }
};

export default config;
