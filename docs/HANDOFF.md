# RunSphere implementation handoff

Updated: 2026-08-28
Branch: `vorflux/full-android-product`
Pull request: https://github.com/swayamn72/RunSphere/pull/6

## Current state

The branch implements an Android-first, privacy-focused fitness foundation for walk, run, and hike activities. It includes authenticated onboarding, encrypted offline recording and resumable upload, server-side validation and 200 m privacy trimming, activity history, weekly goals, curated checkpoint quests, fixed-radius privacy zones, email verification foundations, delayed coarse safety sharing, export/deletion, worker maintenance, and an authenticated staff review dashboard.

Territory capture is intentionally disabled. Clubs are a truthful future-state screen. Cosmetic XP is intentionally excluded.

## Immediate priority order

1. Keep PR #5 green and mergeable.
2. Redesign the six core mobile experiences before adding more backend scope:
   - onboarding and movement selection;
   - home and activity start;
   - map-first quest discovery and quest detail;
   - live recording;
   - validated results and weekly progress;
   - activity history/profile.
3. Complete the remaining Android device validation listed below.
4. Configure production services and real MMR quest data.
5. Consider retention features only after the core loop is polished and measured.

## Current CI checkpoint

On 2026-08-28, PR #5 merged feature head `81f1330` into `main` as merge commit `473e493`. Main run `33155310098` failed at formatting because fixes `67a42c4` and `bf7a7c1` remained only on this feature branch. The branch has now merged `origin/main` without rewriting history so a fresh pull request can run CI against the corrected tree.

Local CI-equivalent verification passed on 2026-08-28 after the formatting and Android permission-verifier fixes:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

The prior GitHub formatting failure was addressed by commit `67a42c4`. The final lint correction in `bf7a7c1` replaces the undeclared Node `process` reference in `apps/mobile/src/verify-android-permissions.mjs`. The reconciled baseline passed `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check` locally on 2026-08-28. Turbo required the documented `/tmp/runsphere-corepack` package-manager shim in this sandbox. PR #6 opened from checkpoint `762806a`; exact-head `Validate and test` run `33164797021` passed: https://github.com/swayamn72/RunSphere/actions/runs/33164797021. Product redesign work may proceed, with the same exact-head green CI gate after every milestone.

## Redesign milestone: theme, shells, and Loop mascot

Checkpoint scope completed on 2026-08-28:

- added complete semantic dark/light tokens and Android system appearance switching;
- migrated current mobile surfaces to theme-aware styles and added large-font-safe tab/focused shells;
- preserved Home, Explore, Season, Clubs, You while visually de-emphasizing future modes;
- added the original app-owned Loop mascot asset system, provenance, accessibility rules, and a restrained Home loading use;
- fixed activity-preparation/back/discard navigation traps;
- fixed clean-install encrypted SQLite provisioning by generating and persisting a non-empty native random key before keyed database access, with no runtime rekey;
- kept territory, exact live-location sharing, photos, and client-authoritative validation disabled.

Validation completed:

- root format, lint, typecheck, test, build, and `git diff --check` passed;
- mobile suite passed with 69 tests across 23 files;
- clean debug and release APK builds passed;
- debug and release APK permission audits exclude `ACCESS_BACKGROUND_LOCATION` and `SYSTEM_ALERT_WINDOW`;
- clean encrypted startup and cold restart passed on Android 15;
- Android light-to-dark switching updated the running process without restart.

Runtime evidence:

- `/code/.generated_artifacts/images/runsphere_release_fresh_light.png`
- `/code/.generated_artifacts/images/runsphere_release_cold_restart_light.png`
- `/code/.generated_artifacts/images/runsphere_release_inplace_dark.png`
- `/code/.generated_artifacts/apk/runsphere-theme-mascot-debug-final.apk`
- `/code/.generated_artifacts/apk/runsphere-theme-mascot-release.apk`

Authenticated Home/mascot, all-tab interaction, Start → Not now, focused-shell, and large-font device walkthroughs remain unverified because the clean install had no authenticated fixture/session. Their pure navigation/theme behavior is covered by unit tests, but device evidence remains open.

## Redesign milestone: interactive map foundation

Checkpoint scope completed on 2026-08-28:

- added pinned MapLibre React Native `11.3.7` with Expo plugin, Android OpenGL variant, and New Architecture compatibility verification;
- added approved HTTPS-origin map style configuration with exact attribution and no silent public endpoint fallback;
- added reusable dark/light map, local-only GeoJSON, camera/follow/free-pan, compass/recenter, lifecycle, retry, fallback, and accessible map/list sheet primitives;
- kept route/checkpoint/sample geometry renderer-local and excluded account/activity/coordinate-bearing app data from provider configuration requests;
- allowed normal non-prompting `ACCESS_NETWORK_STATE` for supported MapLibre connectivity handling while continuing to block background location, Wi-Fi state, storage/media, overlays, biometric, and fingerprint permissions;
- documented provider privacy, local setup, fallback behavior, and the unresolved production attribution-link/terms gate.

Validation completed:

- root format, lint, typecheck, test, build, `verify:maplibre`, and `git diff --check` passed;
- mobile suite passed with 81 tests across 25 files;
- universal debug APK assembled with MapLibre native libraries for all four Android ABIs;
- APK permission audit passed and Android 15 process remained stable across Wi-Fi changes, background/foreground, and dark/light switching;
- provider variables were intentionally unset, so the current source classification is **fallback only**.

Artifact:

- `/code/.generated_artifacts/apk/runsphere-map-foundation-debug.apk`

Android map interaction evidence remains pending until the primitives are mounted in Explore/Live/Results. Task 3 deliberately added no product-screen consumer; fallback/provider rendering, map gestures, sheet interaction, attribution, local GeoJSON, and map TalkBack behavior will be validated in those integration milestones.

## Redesign milestone: truthful Home

Checkpoint scope completed on 2026-08-28:

- extracted Home into a dedicated themed screen and removed fabricated identity, city/date, daily path, streak, fallback quest, proximity, and reward claims;
- added movement-aware Start, server-validated weekly active-minute/distance goal presentation, and fetched `QuestSummary` cards with explicit route-length labels;
- added loading, no-goal, ready, configuration, offline, error, quest-empty, and expired-session handling with request-generation/unmount guards;
- added restrained Loop loading/empty/offline guidance, progressbar semantics, one live status region, large-font-safe layout, and Home state tests;
- updated the design reference to remove the obsolete Daily Path direction.

Validation completed:

- root format, lint, typecheck, test, build, `verify:maplibre`, and `git diff --check` passed;
- mobile suite passed with 85 tests across 25 files;
- fresh universal debug APK built, installed, launched, and reached authenticated onboarding using seeded API data.

Android Home evidence is blocked by test infrastructure: the public Redroid tunnel overwrites bearer `Authorization`, while direct `10.0.2.2:3001` routing timed out. The real Home therefore logs out on its first authenticated request. Do not treat onboarding captures as Home evidence. Production auth behavior was not weakened for testing.

Artifacts:

- `/code/.generated_artifacts/images/runsphere_home_fresh_install.png`
- `/code/.generated_artifacts/images/runsphere_home_after_login.png`
- `/code/.generated_artifacts/recordings/runsphere_home_walkthrough.mp4`
- `/code/.generated_artifacts/apk/runsphere-home-redesign-debug.apk`

## Redesign milestone: Explore map/list integration

Checkpoint scope completed on 2026-08-28:

- extracted Explore and quest detail into dedicated themed screens with a tab-map/flex shell and visible bottom navigation;
- added list/sheet-first browsing with no initial pins, route, proximity, or location request;
- added neutral open/limited/closed, accessibility, and active-time filters over fetched `QuestSummary` only;
- fetches exactly one `QuestDetail` after explicit selection, then renders published checkpoint geometry as renderer-local display-only GeoJSON;
- added pan/zoom/compass and one-shot recenter permission flow with askable denial, blocked/settings reconciliation, and browsing preserved;
- added Android TalkBack list mode, 48dp actions, distinct quest status colors, stale-request guards, typed API failures, and truthful configuration/session/unavailable states;
- clears stale selected quest state when entering or exiting activity flows.

Validation completed before handoff:

- mobile typecheck, lint, and 90 tests across 26 files passed;
- workspace typecheck and tests passed;
- Prettier and `git diff --check` passed.

Android Explore evidence remains pending. The existing Redroid/auth tunnel replaces bearer authorization, so real authenticated catalog/detail rendering needs an authorization-preserving route or an approved native visual fixture. Map provider configuration is still fallback-only.

## Next-agent continuation prompt

Continue RunSphere on branch `vorflux/full-android-product` from the latest pushed commit. Read this file plus `docs/product.md`, `docs/architecture.md`, `docs/safety-and-privacy.md`, `docs/release-plan.md`, and the approved plan/design artifacts under `/code/.plans/` if available. Check the latest exact-head PR #6 GitHub Actions run before editing.

Remaining approved milestones:

1. Redesign Activity Preparation with explicit route/origin state and foreground-location denial recovery (plan task 6).
2. Redesign Live Activity with renderer-local private route, follow/free-pan, provisional metrics, weak-GPS/gap recovery, and no exact live sharing (task 7).
3. Redesign Results so only `status === 'derived'` is validated and only server-derived geometry is mapped; accepted stays pending (task 8).
4. Run final Android/accessibility/privacy/lifecycle/performance evidence and update this handoff (task 9).

After every milestone: run focused tests plus root format/lint/typecheck/test/build, `verify:maplibre`, native debug build and permission audit when applicable; update `docs/HANDOFF.md`; make a small commit; push; and require green PR #6 CI for the exact SHA. Never enable territory, exact live-location sharing, photos, nearby runners, speed pressure, client checkpoint authority, or unapproved public map endpoints. Production map provider/attribution terms and authenticated Redroid evidence remain open blockers.

## Activity Preparation milestone — 2026-08-28

The continuation work remains on `vorflux/full-android-product`. PR #6 merged at `2d6937c`; future exact-head gates must use a continuation pull request targeting `main`, because merged PR #6 cannot receive later commits.

Implemented explicit Home/Explore/quest-detail activity origin state, precise foreground-location recovery, inline denial/blocked/settings states, and an in-memory start gate requiring three usable fixes (`accuracy <= 50 m`) within 30 seconds. Acquisition observations are never persisted. Legacy `prepare`/`acquiring` rows are discarded during encrypted-recorder initialization so pre-route attempts do not leak into history or recovery. Background-location and foreground-service request paths and permissions were removed.

Validation passed for this milestone:

- focused preparation suite: 8 files, 28 tests;
- root Prettier, lint, typecheck, test, build, MapLibre compatibility, and `git diff --check`;
- fresh universal debug APK assembly and APK permission audit;
- Android 15 Redroid install and cold launch.

The permission audit confirmed absence of `ACCESS_BACKGROUND_LOCATION`, `ACCESS_WIFI_STATE`, overlays, storage/media, biometric, and fingerprint permissions.

Device-level authenticated preparation flows remain blocked by the documented HTTPS tunnel behavior that does not preserve bearer `Authorization`. The evidence below proves build/install/pre-auth launch only, not authenticated preparation behavior:

- `/code/.generated_artifacts/apk/runsphere-activity-preparation-debug.apk`
- `/code/.generated_artifacts/images/runsphere-preparation-fresh-launch.png`
- `/code/.generated_artifacts/images/runsphere-preparation-account-form.png`
- `/code/.generated_artifacts/images/runsphere-preparation-account-submit.png`
- `/code/.generated_artifacts/recordings/runsphere-activity-preparation-onboarding.mp4`

## Confirmed validation still pending

The latest Android test report is **partial**, not failed. The corrected universal APK builds, installs, launches, and excludes `ACCESS_BACKGROUND_LOCATION` and `SYSTEM_ALERT_WINDOW`. Workspace checks and 17 PostGIS API integration tests passed.

Still required before release approval:

- deny foreground location and verify browsing/settings recovery;
- record, pause, resume, terminate, relaunch, and recover/sync an activity on-device;
- switch accounts and verify local recorder data remains account-isolated;
- inject weak-accuracy and 61+ second gaps through the device flow and verify private retention with exclusion from authoritative totals.

Latest evidence:

- `/code/.generated_artifacts/apk/RunSphere-debug-universal.apk`
- `/code/.generated_artifacts/images/runsphere-permission-fixed-launch.png`
- `/code/.generated_artifacts/images/runsphere-launch.png`
- `/code/.generated_artifacts/images/runsphere-account-form.png`
- `/code/.generated_artifacts/recordings/runsphere-android-onboarding.mp4`

## UI assessment and redesign direction

The current mobile UI is functional but not consumer-product quality. It is text-heavy, has weak hierarchy, uses settings-like layouts for core journeys, has little map/exploration presence, and provides limited visual reward or motion.

Do not simply restyle every existing screen. Redesign the information architecture around one core loop:

`Discover or choose activity → record privately → validate → show progress → suggest next action`

Design principles:

- map and nearby opportunities should dominate Explore;
- one obvious primary action per screen;
- move privacy explanations into concise contextual disclosures and progressive detail;
- use progress rings, route thumbnails, weekly consistency, explored places, and quest completion instead of cosmetic XP;
- keep pace comparison optional and avoid speed-centric rewards;
- maintain accessibility labels, contrast, large touch targets, reduced-motion support, and explicit offline/error states;
- keep territory, live nearby runners, AR, wearables, and advanced routing outside the redesign scope.

The existing artifacts under `/code/.plans/designs/` are direction references, not final polished designs. A new design pass should produce high-fidelity Android screens and a reusable token/component specification before implementation.

## Production setup to confirm

These are launch preparations rather than currently proven code failures:

- connect an email/outbox provider to deliver verification tokens;
- import reviewed MMR quest/checkpoint data using `scripts/data/import-reviewed-quests.mjs`;
- configure production map/tile/geocoding providers;
- provision production PostGIS, object storage, secrets, backups, metrics collector token, monitoring, and staff access;
- execute restore, deletion, support-escalation, cost, GPS-quality, and battery field-study gates from `docs/release-plan.md`.

## Future product roadmap

Recommended order after the polished core loop has retention evidence:

1. Route mastery: reward repeated exploration, route variety, and consistency.
2. Cooperative club relays: private aggregate contributions without live location or speed ranking.
3. Optional territory seasons: only after fairness, privacy, concentration, anti-cheat, and launch-cluster gates pass.
4. Later: cycling, wearables, advanced route recommendations, and AR.

## Useful commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build

cd apps/mobile/android
./gradlew clean assembleDebug
cd ../../..
node apps/mobile/src/verify-android-permissions.mjs
```

When Turbo cannot locate pnpm in this sandbox:

```sh
mkdir -p /tmp/runsphere-corepack
corepack enable --install-directory /tmp/runsphere-corepack
PATH="/tmp/runsphere-corepack:$PATH" pnpm lint
```

## Commit discipline

- Work only on `vorflux/*` branches.
- Keep commits narrow and push after every green milestone.
- Update this file whenever priorities, blockers, validation status, or rollout decisions change.
- Never enable territory or expose exact live location as part of an unrelated UI change.
