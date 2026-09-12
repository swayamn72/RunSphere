import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Firebase's own config, which carries the sender id FCM addresses this
 * installation by. Not a secret — it ships inside every APK — but not
 * committed either, because it names one specific Firebase project and a
 * checkout building against somebody else's would silently register devices
 * into it.
 *
 * Resolved rather than named unconditionally: `@expo/config-plugins`
 * copies this file during `expo prebuild`, and a missing one aborts the
 * prebuild *after* it has already cleared `android/`, leaving a half-generated
 * native project that Gradle then fails to configure. A checkout without
 * Firebase credentials builds and runs; only push delivery is absent, and
 * `push-registration.ts` already treats that as an ordinary non-state.
 */
const resolveGoogleServicesFile = (): string | undefined => {
  const configured = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const path = isAbsolute(configured) ? configured : resolve(__dirname, configured);
  return existsSync(path) ? configured : undefined;
};

const googleServicesFile = resolveGoogleServicesFile();

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
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE'
    ],
    // Absent when no Firebase config has been placed in the checkout; see
    // `resolveGoogleServicesFile` above and `apps/mobile/DEVELOPMENT.md`.
    ...(googleServicesFile ? { googleServicesFile } : {}),
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
          'Allow RunSphere to use your location while you record an activity.'
      }
    ],
    [
      'expo-sensors',
      {
        motionPermission:
          'Allow RunSphere to access motion and fitness data to improve activity estimates.'
      }
    ],
    ['@maplibre/maplibre-react-native', { android: { nativeVariant: 'opengl' } }],
    // Deliberately unconfigured: no custom icon, sound, or colour. A push here
    // is a data-only wake-up carrying an opaque id, and the app renders the
    // entry from the durable inbox — so there is nothing for the OS to style.
    'expo-notifications'
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
