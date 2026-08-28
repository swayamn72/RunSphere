# Android debug APK

The committed `android/` directory is the reproducible native path for Android development. It is generated from `app.config.ts` and should be refreshed deliberately with `pnpm prebuild:android` when Expo native settings change. The activity recorder enables SQLCipher through the Expo SQLite plugin, so regenerate Android before assembling after this setting changes; SQLCipher affects every Expo SQLite database in the app, and each must set its key before any access.

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
