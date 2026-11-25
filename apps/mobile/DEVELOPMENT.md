# Android debug APK

The committed `android/` directory is the reproducible native path for Android development. It is generated from `app.config.ts` and should be refreshed deliberately with `pnpm prebuild:android` when Expo native settings change.

**`prebuild` clears `android/` before it regenerates it, and it does not preserve hand-edits.** Four deliberate edits live in the committed project and have to be reapplied after every prebuild — `git diff apps/mobile/android` after running it, and put these back:

| File                                                         | Edit                                               | Why                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android/app/build.gradle`                                   | `debuggableVariants = []`                          | Embeds the JS bundle in debug APKs so emulator and device installs do not need a Metro server. Prebuild comments this out.                                                                                        |
| `android/gradle.properties`                                  | `edgeToEdgeEnabled=false`                          | Keeps the app inset-aware until it adopts `react-native-safe-area-context`. Prebuild sets it to `true`.                                                                                                           |
| `android/gradle.properties`                                  | `-Dfile.encoding=UTF-8` in `org.gradle.jvmargs`    | Required on Windows under Java 17; see the comment in that file. Prebuild drops it with the rest of the override.                                                                                                 |
| `android/app/src/{debug,debugOptimized}/AndroidManifest.xml` | `SYSTEM_ALERT_WINDOW` marked `tools:node="remove"` | `blockedPermissions` in `app.config.ts` only reaches the main manifest, so the debug variants would otherwise re-grant it. `verify-android-permissions.mjs` reads the main manifest only and does not catch this. |

EAS builds take their API address from EAS, not from git: each profile in `eas.json` names an
EAS environment (`development`, `preview`, `production`). Set the address once per environment,
using HTTPS for `preview` and `production` (the app refuses plain HTTP outside local
development):

```sh
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.example.com
eas env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL --value https://staging-api.example.com
eas env:create --environment development --name EXPO_PUBLIC_API_BASE_URL --value http://<your-lan-ip>:3001
```

The map style values (`EXPO_PUBLIC_MAP_STYLE_URL`, `_ORIGINS`, `_ATTRIBUTION`) are set the same way.
Local `expo start` keeps reading `apps/mobile/.env`.

Friend invite links (`runsphere://invite/<token>`) need `scheme: 'runsphere'` in `app.config.ts`, which prebuild turns into the manifest's `runsphere` intent-filter; nothing to reapply.

No Firebase config is committed (see `app.config.ts`). Without `google-services.json` in this directory, `app.config.ts` omits `googleServicesFile` entirely and the build succeeds with push delivery absent — the durable in-app inbox is unaffected. Do not reintroduce an unconditional `googleServicesFile`: a missing file aborts prebuild _after_ `android/` has been cleared, leaving a half-generated project whose Gradle configuration then fails on unresolvable project paths.

The activity recorder enables SQLCipher through the Expo SQLite plugin, so regenerate Android before assembling after this setting changes; SQLCipher affects every Expo SQLite database in the app, and each must set its key before any access.

## iOS

`ios/` is generated from `app.config.ts` by `pnpm prebuild:ios` and committed, like `android/`. Unlike Android it carries **no hand-edits**, so prebuild is safe to re-run and the `iOS` workflow fails if the committed project drifts from the config. Run it whenever Expo native settings change, then `pod install` in `ios/`.

Requirements: macOS, Xcode 16+ (built with 27.2), CocoaPods, and an Apple Developer account for devices and TestFlight.

```sh
pnpm --filter @runsphere/mobile prebuild:ios      # regenerate ios/ (only after config changes)
cd apps/mobile/ios && pod install
pnpm --filter @runsphere/mobile ios               # build and run in the Simulator
pnpm --filter @runsphere/mobile ios:build:simulator   # CLI build, no signing (what CI runs)
```

- **Bundle id** `com.runsphere.app`, iOS 16.4+, iPhone only, light by default with an optional dark theme (ADR-0016; Map and live run stay dark).
- **Background recording:** the `location` background mode (When-In-Use permission, no "Always") is the iOS counterpart of Android's foreground service. `NSMotionUsageDescription` is stripped on purpose; nothing reads motion data.
- **Push:** `GoogleService-Info.plist` is optional and untracked; `app.config.ts` omits it when absent, same as `google-services.json`. APNs also needs the Push Notifications capability and an APNs key uploaded to Firebase/EAS.
- **Signing and release:** `eas build -p ios --profile production`, then `eas submit -p ios`. Set `ascAppId` in `eas.json` first. Free Apple IDs cannot use the location background mode on devices reliably; use a paid team.
- **Not yet verified on hardware:** run recording with the screen locked, SQLCipher, biometric prompt and push delivery. Check these on a physical iPhone before TestFlight.

## Prerequisites

- Node 24 LTS and pnpm 10.12.1
- Android SDK with a platform accepted by the generated project
- Java 17

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to a stable public API host when the mobile app needs server calls. Do not commit preview tunnel URLs. The m0 home shell works without this value.

## Map provider configuration

Map rendering is intentionally provider-opt-in. Set all of the following only after the style origin, provider terms, attribution wording, privacy review, and operational owner have been approved:

- `EXPO_PUBLIC_MAP_STYLE_URL`: the provider's HTTPS style URL.
- `EXPO_PUBLIC_MAP_STYLE_ORIGINS`: comma-separated exact HTTPS origins approved for that style URL (for example, `https://maps.example.com`).
- `EXPO_PUBLIC_MAP_ATTRIBUTION`: the provider's exact required attribution wording.

Do not commit an endpoint, credential, token, or placeholder provider URL. When any value is absent, invalid, or rejected by the origin policy, RunSphere renders its app-owned map fallback. It never falls back to a public style or tile service. Provider traffic must contain only provider resource URLs, normal tile coordinates, and provider-required non-user-specific authentication. Do not add account IDs, activity IDs, route/checkpoint geometry, or any app coordinates to URLs, headers, query values, referrers, logs, analytics, or telemetry. Route and checkpoint GeoJSON stays renderer-local.

Provider-backed maps must show the exact configured attribution at 12sp or larger. Test fallback/offline handling separately; product copy is limited to `Map details unavailable` and `Offline map view`.

Build a universal debug APK with:

```sh
pnpm --filter @runsphere/mobile android:assemble:debug
```

The output is `android/app/build/outputs/apk/debug/app-debug.apk`. No ABI filters are configured, so the debug APK supports ARM and x86_64 emulator/device targets.

## Public preview CORS

The API reads `CORS_ALLOWED_ORIGINS` as a comma-separated allowlist. When a public admin preview is exposed, set its exact origin before starting the API, for example:

```sh
CORS_ALLOWED_ORIGINS=https://<preview-host>.preview.us1.vorflux.com pnpm --filter @runsphere/api dev
```

Use a durable deployed admin origin for non-preview environments; do not commit an ephemeral preview host.

### Recorder disposition migration

The legacy SQLite migration adds `activity_location_samples.disposition` with its safe default but does not add the current `CHECK` constraint. SQLite cannot add that constraint without rebuilding the table, which would be unsafe for private on-device recordings. New writes are constrained by the current schema and typed recorder; the legacy table remains additive until a separately reviewed migration can preserve all local recordings during a rebuild.
