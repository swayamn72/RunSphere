import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';
import { withGradleProperties, withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

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

/**
 * iOS counterpart of `resolveGoogleServicesFile`: `GoogleService-Info.plist`
 * is copied during `expo prebuild --platform ios`, and a missing file aborts
 * it after `ios/` has been cleared. Absent means push delivery is absent,
 * nothing else.
 */
const resolveGoogleServiceInfoPlist = (): string | undefined => {
  const configured = process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist';
  const path = isAbsolute(configured) ? configured : resolve(__dirname, configured);
  return existsSync(path) ? configured : undefined;
};

const googleServiceInfoPlist = resolveGoogleServiceInfoPlist();

/**
 * `expo-location` always writes a motion-activity purpose string, and the
 * pre-iOS 11 "Always" one, even though nothing reads motion data (the Android
 * `ACTIVITY_RECOGNITION` permission is blocked for the same reason). Dropping
 * them keeps the permission surface, and the App Review questions, minimal.
 */
const withoutUnusedIosPurposeStrings: ConfigPlugin = (expoConfig) =>
  withInfoPlist(expoConfig, (modConfig) => {
    delete modConfig.modResults.NSMotionUsageDescription;
    delete modConfig.modResults.NSLocationAlwaysUsageDescription;
    return modConfig;
  });

/**
 * Release builds run R8: it shrinks and obfuscates the DEX and drops unused
 * resources. Play Console flags a release whose code is barely obfuscated, and
 * that can limit its visibility. Set as a config plugin, not a hand-edit of
 * `gradle.properties`, so `expo prebuild` keeps it. Libraries ship their own
 * keep rules; app-specific ones go in `android/app/proguard-rules.pro`.
 */
const R8_RELEASE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true'
};

const withR8InReleaseBuilds: ConfigPlugin = (expoConfig) =>
  withGradleProperties(expoConfig, (modConfig) => {
    for (const [key, value] of Object.entries(R8_RELEASE_PROPERTIES)) {
      modConfig.modResults = modConfig.modResults.filter(
        (item) => !(item.type === 'property' && item.key === key)
      );
      modConfig.modResults.push({ type: 'property', key, value });
    }
    return modConfig;
  });

const config: ExpoConfig = {
  name: 'TURFR',
  slug: 'runsphere',
  // Friend invite links open the app: runsphere://invite/<token> (ADR-0014).
  scheme: 'runsphere',
  version: '0.1.0',
  orientation: 'portrait',
  // Light by default; the runner can pick Dark or Match phone (ADR-0016). The
  // app sets the scheme itself, which needs the platform to allow either.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  android: {
    package: 'com.runsphere.app',
    allowBackup: false,
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS',
      // Run verification (`safety-and-privacy.md`). Both were blocked until the
      // gate shipped. `USE_BIOMETRIC` is the current permission;
      // `USE_FINGERPRINT` is its pre-API-28 predecessor, and the
      // `expo-local-authentication` config plugin declares both, so blocking
      // one would leave prebuild and `verify-android-permissions.mjs`
      // permanently disagreeing.
      //
      // Neither grants RunSphere access to biometric data. They permit asking
      // the OS to raise its own prompt; the match happens in secure hardware
      // and the app receives a boolean.
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.VIBRATE'
    ],
    // Absent when no Firebase config has been placed in the checkout; see
    // `resolveGoogleServicesFile` above and `apps/mobile/DEVELOPMENT.md`.
    ...(googleServicesFile ? { googleServicesFile } : {}),
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      // Nothing reads motion data, so asking for it would fail Play's "use only
      // what you need" review and DPDP minimisation (M8 C.3).
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE'
    ]
  },
  ios: {
    bundleIdentifier: 'com.runsphere.app',
    icon: './assets/ios-icon.png',
    // Incremented per App Store Connect upload; `eas.json` auto-increments it
    // for the production profile.
    buildNumber: '1',
    // Phone-only at launch: the layouts are designed and checked at phone
    // widths, and an iPad build would be reviewed as a stretched phone app.
    supportsTablet: false,
    ...(googleServiceInfoPlist ? { googleServicesFile: googleServiceInfoPlist } : {}),
    infoPlist: {
      // The only cryptography is OS-provided (SQLCipher, TLS, SecureStore),
      // which is exempt under Apple's standard-encryption rule. Declared so
      // each TestFlight upload skips the export-compliance prompt. Revisit
      // before adding any custom cipher.
      ITSAppUsesNonExemptEncryption: false,
      // Raw-HTTP fetches are limited to local development; production API and
      // map origins must be HTTPS (see `.env.example`).
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true }
    },
    // Required-reason API declarations for the app's own code. Expo's modules
    // ship their own manifests; Xcode merges them into the app's privacy report.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1']
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1']
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1']
        }
      ]
    }
  },
  plugins: [
    // Listed first: config mods run in reverse order, so this one sees the
    // Info.plist after `expo-location` has written its keys.
    withoutUnusedIosPurposeStrings,
    withR8InReleaseBuilds,
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Allow TURFR to confirm it is you before a run starts, so your runs cannot be recorded by somebody else.'
      }
    ],
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow TURFR to use your location while you record an activity.',
        // A location foreground service keeps a run recording with the screen
        // locked, started from the Start tap, without ACCESS_BACKGROUND_LOCATION
        // (still blocked below). Adds FOREGROUND_SERVICE(_LOCATION) (M8 C.3).
        isAndroidForegroundServiceEnabled: true,
        // iOS equivalent: the `location` background mode keeps a started run
        // recording with the screen locked, under When-In-Use permission only
        // (the blue status pill shows). No "Always" permission is requested.
        isIosBackgroundLocationEnabled: true,
        locationAlwaysAndWhenInUsePermission:
          'Allow TURFR to keep recording your run while your screen is locked.'
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
    mapAttribution: process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? '',
    eas: {
      projectId: '164582a7-92e6-4b2b-ab0d-41ab012b45ef'
    }
  }
};

export default config;
