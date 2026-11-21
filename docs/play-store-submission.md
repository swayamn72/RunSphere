# Google Play submission guide

> M8 C.4. Written 2026-11-22 from the code at that date. Every answer below describes what the app
> actually does; if the code changes, change this file in the same commit. Play policy changes
> often: check each form's live help page before submitting. Legal text is still a draft (C.7).

## 1. Before the first upload (owner)

| Step                                     | Notes                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Developer account                        | Personal or organisation. An organisation account needs a D-U-N-S number (can take weeks) but skips the closed-test rule below.                  |
| Identity verification                    | Required for every developer (Android developer verification). Play Console shows a task until it is done.                                       |
| Package name                             | `com.runsphere.app` (`apps/mobile/app.config.ts`). Create the app in Play Console early to claim it; it can't be changed after the first upload. |
| Closed test (new personal accounts only) | At least 12 testers opted in for 14 days in a row before you can apply for production.                                                           |
| Target API                               | 36 (Android 16), from Expo 57's defaults. Required since 31 Aug 2026.                                                                            |
| Signing                                  | Play App Signing with an EAS-managed upload key.                                                                                                 |
| API address                              | Each EAS profile reads `EXPO_PUBLIC_API_BASE_URL` from its EAS environment (`apps/mobile/DEVELOPMENT.md`); it must be HTTPS.                     |

## 2. Store listing

- **Category:** Health & Fitness.
- **Privacy policy URL:** `https://<api-host>/privacy` (served by the API, `services/api/src/legal-pages.ts`).
- **Account deletion URL:** `https://<api-host>/account/delete`.
- **Contact email:** a monitored address. Use the grievance officer's (`GRIEVANCE_OFFICER_EMAIL`).

## 3. App content forms

### App access

Sign-in is required. Give reviewers a working account with a **verified email** (safety contacts need
one), created through the normal sign-up and verified through the emailed link. Note in the
instructions that a run needs real movement or the reviewer can browse Turf, Map and Social without
recording.

### Ads

No ads.

### Content rating (IARC questionnaire)

- Users can interact: **yes** (usernames, display names, club names; friend requests). No chat or
  messaging, no photos.
- Shares location with other users: **yes**. A runner can share a run with a chosen safety contact,
  delayed by at least 15 minutes and coarsened to at least 500 m. Claimed ground is shown on the
  Turf map.
- Gambling, purchases, violence: none.

### Target audience

18 and over only. Sign-up refuses anyone under 18 (`isAdult` in `packages/domain`).

### Data safety

Data is encrypted in transit (HTTPS only; plain HTTP is allowed in debug builds only). Users can ask
for deletion in the app and at `/account/delete`. **Nothing is shared** with third parties in Play's
sense: the host, email provider and Firebase Cloud Messaging are service providers processing on our
behalf.

| Data type (Play category)                                     | Collected                      | Optional?                                           | Purposes                                                                          | Notes                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Location → Precise location                                   | Yes                            | Required to record a run; browsing works without it | App functionality; Fraud prevention, security and compliance                      | Only while a run is recording. Raw points deleted after 30 days; the privacy-trimmed route stays until the user deletes their account. |
| Location → Approximate location                               | Yes                            | Same as above                                       | App functionality                                                                 | Coarse cells for safety shares and Turf.                                                                                               |
| Personal info → Email address                                 | Yes                            | Required                                            | Account management; App functionality (safety contacts); Developer communications | Campaign email only with consent.                                                                                                      |
| Personal info → Name                                          | Yes                            | Required (username), optional (display name)        | App functionality; Account management                                             |                                                                                                                                        |
| Personal info → Other info                                    | Yes, **processed ephemerally** | Required                                            | Account management (age check)                                                    | Date of birth: checked at sign-up, never stored (migration 052).                                                                       |
| Health and fitness → Fitness info                             | Yes                            | Required for runs                                   | App functionality                                                                 | Distance, duration and pace of runs. No heart rate or body data.                                                                       |
| App activity → Other actions                                  | Yes                            | Required                                            | App functionality                                                                 | Claims, XP, achievements, challenges, clubs.                                                                                           |
| App activity → Other user-generated content                   | Yes                            | Optional                                            | App functionality                                                                 | Club names and descriptions.                                                                                                           |
| Device or other IDs                                           | Yes                            | Optional (only if notifications are allowed)        | App functionality                                                                 | FCM push token.                                                                                                                        |
| App info and performance                                      | No                             | —                                                   | —                                                                                 | No crash reporting or analytics SDK is included.                                                                                       |
| Photos, audio, contacts, messages, files, calendar, financial | No                             | —                                                   | —                                                                                 |                                                                                                                                        |

### Health apps declaration

Answer: the app offers **Activity and fitness** features (records runs: distance, time, route). It
does not use Health Connect and doesn't read heart rate, body measurements or medical data.

### Foreground service declaration (Android 14+)

- **Type:** `location` (declared by expo-location's `LocationTaskService`; permissions
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`).
- **Feature:** keeps recording a run's GPS route while the screen is locked.
- **Started by:** the runner tapping Start on the run screen. It stops when the run is paused,
  finished, or the app is swiped away (`killServiceOnDestroy`). A persistent notification,
  "Recording your run", shows the whole time.
- **Impact if unavailable:** a run stops recording as soon as the phone locks, so distance, route
  and Turf claims are wrong or missing.
- **Video (record on a real device, ~30 s):** open RunSphere → Run → Start → show the "Recording your
  run" notification → lock the screen → unlock → show the route kept growing → Finish → show the
  notification is gone.

### Precise location declaration

Precise location (`ACCESS_FINE_LOCATION`) is needed **continuously during a run**: distance is
measured from GPS points a few metres apart, runs are checked for fair play (speed, jumps), and
territory is computed from the exact route. Coarse location (~1–3 km) can't measure a 5 km run. The
location button covers one-time access only, and a run needs a stream of fixes for its whole
duration. The app never requests background location (`ACCESS_BACKGROUND_LOCATION` is blocked in
`app.config.ts` and the manifest).

### Background location

Not requested. Leave the declaration empty.

## 4. Permissions the build declares

Checked on every `pnpm test` by `apps/mobile/src/verify-android-permissions.mjs`: coarse and fine
location, network state, foreground service (+ location), internet, notifications, biometric and
fingerprint (the OS screen-lock prompt for run verification; the app only receives yes/no), and
vibrate. Blocked: background location, activity recognition, Wi-Fi state, overlay, external storage.

Libraries add a few normal, non-prompting permissions to the merged manifest (wake lock, boot
completed for notifications, Wi-Fi multicast, launcher badges, Play install referrer). They need no
declaration. Check the final list with `./gradlew :app:processDebugMainManifest` and
`app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml`.

## 5. Owner checklist before pressing "Send for review"

- [ ] Lawyer has approved the legal text, `LEGAL_POLICY_VERSION` no longer ends in `-draft`, and the
      draft banner is gone (C.7).
- [ ] `LEGAL_OPERATOR_NAME`, `GRIEVANCE_OFFICER_NAME` and `GRIEVANCE_OFFICER_EMAIL` are set on the API.
- [ ] The privacy policy URL opens over HTTPS from a phone.
- [ ] The foreground-service video is recorded on a device (C.3 is not field-tested until then).
- [ ] The reviewer account works and has a verified email.
- [ ] Data safety answers re-checked against this file and the code.
