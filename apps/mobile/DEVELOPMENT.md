# Android debug APK

The committed `android/` directory is the reproducible native path for Android development. It is generated from `app.config.ts` and should be refreshed deliberately with `pnpm prebuild:android` when Expo native settings change. The activity recorder enables SQLCipher through the Expo SQLite plugin, so regenerate Android before assembling after this setting changes; SQLCipher affects every Expo SQLite database in the app, and each must set its key before any access.

## Prerequisites

- Node 24 LTS and pnpm 10.12.1
- Android SDK with a platform accepted by the generated project
- Java 17

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to a stable public API host when the mobile app needs server calls. Do not commit preview tunnel URLs. The m0 home shell works without this value.

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
