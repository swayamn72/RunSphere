# RunSphere implementation handoff

Updated: 2026-09-04
Baseline: `main` at `d2aca92`. Phase 2 milestones 2.1 through 2.6 are committed
on `main`; 2.7 (push delivery) and 2.8 (Loop guidance and polish) are
implemented and validated locally but are **not yet committed**, as are 2.9
(first mobile surfaces for the Foundation gate's social and notification routes)
and Phase 3 milestones 3.1 (clubs) and 3.2 (club relays). All of it needs a
fresh `vorflux/*` branch and a new pull request targeting `main`, because merged
PRs #6 and #8 cannot receive later commits. The rest of Phase 3 — club and
global boards, competitions, moderation, campaigns, admin areas — is the next
scope.
Last merged pull request: https://github.com/swayamn72/RunSphere/pull/8

## Current state

The branch implements an Android-first, privacy-focused fitness foundation for walk, run, and hike activities. It includes authenticated onboarding, encrypted offline recording and resumable upload, server-side validation and 200 m privacy trimming, activity history, weekly goals, curated checkpoint quests, fixed-radius privacy zones, email verification foundations, delayed coarse safety sharing, export/deletion, worker maintenance, and an authenticated staff review dashboard.

Territory capture is intentionally disabled. Clubs are a truthful future-state screen.

Cosmetic XP was excluded through PR #7 and is no longer excluded. PR #8 merged the
Phase 1 gamification foundation into `main`, adding server-authoritative cosmetic
progression, achievements, profiles, friends/blocks, the notification inbox, and
staff RBAC (migrations 011-017). Progression stays cosmetic-only under ADR-0005,
and no mobile surface consumes it yet.

## Immediate priority order

1. Keep the working branch green and mergeable. PRs #5 through #8 have merged and
   `main` is the current baseline; because a merged pull request cannot receive
   later commits, every new milestone needs a fresh pull request.
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

## Live Activity milestone — 2026-08-28

Implemented encrypted recorder schema v7, private renderer-local segmented routes, follow/free-pan/recenter camera state, provisional neutral metrics, weak/missing GPS recovery, and explicit paused recovery after process relaunch. Only usable observations (`accuracy <= 50 m`) and flagged weak observations (`50–100 m`) are retained with explicit accuracy; unknown, negative, and `>100 m` fixes are dropped for privacy minimization and client/server consistency. Pauses, weak fixes, impossible segments, and gaps over 60 seconds never bridge route geometry or provisional totals. No local coordinate or route layer enters map-provider configuration or logging.

Validation passed for this milestone:

- focused Live suites: 27 implementation tests, plus an independent 23-test recorder/native adapter/map/Live test pass;
- root Prettier, lint, typecheck, test, build, MapLibre compatibility, and `git diff --check`;
- fresh universal debug APK assembly, Android 15 install/cold launch, and APK permission audit.

Authenticated Live device flows remain blocked by the same authorization-stripping HTTPS route. No synthetic device location pathway was enabled; GPX cases remain pure test fixtures under ADR-0003. The following artifacts prove build/install/pre-auth launch only:

- `/code/.generated_artifacts/apk/runsphere-live-activity-debug.apk`
- `/code/.generated_artifacts/images/runsphere-live-fresh-launch.png`

Still pending after an approved authenticated route exists: record/pause/resume/finish, pan/recenter, weak and 61+ second gap recovery, fallback map, background/foreground and process recovery, TalkBack, large text, theme, and reduced-motion evidence.

## Results milestone — 2026-08-28

Implemented one Results presentation boundary where only a freshly fetched `status === 'derived'` detail with a server summary is validated. Local, queued, received, validating, accepted, offline, and cached-status states remain provisional/pending; rejected results stay private and use non-punitive copy. Pending/rejected screens retain explicitly labeled provisional recorded metrics. Only valid server-derived line geometry is mapped renderer-locally; null, malformed, rejected, and non-derived geometry produces no route map, and local recorder samples never enter Results.

Encrypted recorder schema v8 adds nullable, non-sensitive `remote_status` metadata through an additive, metadata-checked migration. It supports truthful offline lifecycle labels without treating cached status alone as validation; legacy `processed` rows remain unknown until refreshed. Home weekly progress continues to reload from `GET /v1/goals/weekly` when Home remounts.

Validation passed for this milestone:

- mobile Results/recorder/sync suite: 117 tests;
- shared contract tests;
- API/PostGIS integration: 17 tests across four files, including non-derived detail projection;
- root Prettier, lint, typecheck, test, build, MapLibre compatibility, and `git diff --check`;
- fresh universal debug APK assembly, Android 15 install/cold launch, and APK permission audit.

Authenticated Results device states remain blocked by the authorization-stripping HTTPS route. The following artifacts prove build/install/pre-auth launch only:

- `/code/.generated_artifacts/apk/runsphere-results-debug.apk`
- `/code/.generated_artifacts/images/runsphere-results-fresh-launch.png`

Still pending after an approved authenticated route exists: queued/processing/accepted/rejected/derived presentation; server-derived valid, discontinuous privacy-trimmed, and null route states; offline/relaunch reconciliation; Home/history refresh; TalkBack and large-text evidence.

## Final validation checkpoint — 2026-08-28

Final code review found and corrected five core-loop defects before release gating: a finish-time React hook-order crash, an unbounded Results detail fetch loop, stale follow/free-pan reporting, stranded deleted activities, and inconsistent rejected terminal handling. `eslint-plugin-react-hooks` and a React Native render harness now guard these boundaries. History/detail fetching is bounded to three concurrent requests, terminal rows are not retried, result-center work is bounded, Live spacing is safer at large text, and map controls retain 48 dp minimum targets.

Final clean validation at candidate head before the checkpoint commit passed:

- focused activity suite: 13 files, 62 tests;
- full mobile suite after final fixes: 33 files, 127 tests;
- root Prettier, lint, typecheck, test, build, MapLibre compatibility, and `git diff --check`;
- fresh universal Android debug build after clearing stale native CMake output;
- exact APK permission audit;
- Android 15 Redroid cold launch, background/foreground, force-stop/relaunch;
- pre-auth accessibility-tree review, dark/light, 1.30 font scale, and reduced motion;
- pre-auth runtime log/network privacy review with no coordinate/provider leakage.

Measured reachable pre-auth performance:

- cold activity launch: 526 ms;
- force-stop relaunch: 565 ms;
- stabilized total PSS: 177247 KB.

Final evidence:

- `/code/.generated_artifacts/apk/RunSphere-final-debug-universal.apk`
- `/code/.generated_artifacts/logs/runsphere-focused-tests.log`
- `/code/.generated_artifacts/logs/runsphere-root-format-check.log`
- `/code/.generated_artifacts/logs/runsphere-root-lint.log`
- `/code/.generated_artifacts/logs/runsphere-root-typecheck.log`
- `/code/.generated_artifacts/logs/runsphere-root-test.log`
- `/code/.generated_artifacts/logs/runsphere-root-build.log`
- `/code/.generated_artifacts/logs/runsphere-maplibre.log`
- `/code/.generated_artifacts/logs/runsphere-final-debug-build.log`
- `/code/.generated_artifacts/logs/runsphere-final-apk-audit.log`
- `/code/.generated_artifacts/logs/runsphere-final-launch.log`
- `/code/.generated_artifacts/logs/runsphere-final-meminfo.txt`
- `/code/.generated_artifacts/images/runsphere-final-fresh-launch.png`
- `/code/.generated_artifacts/images/runsphere-final-onboarding-dark.png`
- `/code/.generated_artifacts/images/runsphere-final-onboarding-dark-large-font-reduced-motion.png`
- `/code/.generated_artifacts/images/runsphere-final-onboarding-light-restored.png`
- `/code/.generated_artifacts/logs/runsphere-final-onboarding-ui.xml`
- `/code/.generated_artifacts/logs/runsphere-final-large-font-ui.xml`
- `/code/.generated_artifacts/logs/runsphere-final-runtime-log-review.txt`
- `/code/.generated_artifacts/recordings/runsphere-final-preauth-accessibility.mp4`
- `/code/.generated_artifacts/logs/runsphere-redroid-direct-network.log`
- `/code/.generated_artifacts/logs/runsphere-final-auth-route-logcat.txt`
- `/code/.generated_artifacts/images/runsphere-final-auth-route-outcome.png`

Release blockers remain open and are not waived:

- authenticated Preparation, Live, and Results device evidence requires an authorization-preserving staging HTTPS API or approved equivalent; ADB reverse reached local TCP but the real sign-in request did not complete;
- production map-provider origin, attribution URL/wording, terms/privacy review, and operational ownership remain unresolved, so production maps stay fallback-only;
- physical-device GPS/distance/battery freeze remains incomplete. Emulator and pure synthetic fixtures do not satisfy the required 20+ one-hour sessions across 5+ representative devices or the measured-route study;
- account-switch isolation, full TalkBack traversal, authenticated process-kill recovery, and one-hour Live CPU/frame/battery evidence remain pending behind the authenticated environment and physical-device matrix.

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

## Phase 2 milestone 2.1 — mobile API client extensions, 2026-09-03

Baseline is `main` at `85d3cdb`, after PR #8 merged the Phase 1 gamification
foundation. This change is client-only: `apps/mobile/src/api-client.ts` gained
typed methods for every Phase 1 gamification route (profile, friends, blocks,
notification inbox and preferences, progression, achievements) plus the
contract-frozen challenge calls that stay unimplemented server-side until
milestone 2.5. Details are in
[`gamification-detailed-plan.md`](gamification-detailed-plan.md).

No product screen consumes the new methods yet, so nothing user-visible changed
and no new device evidence is claimed. Territory, exact live-location sharing,
photos, and client-authoritative validation all remain disabled.

Two latent client defects were fixed at the same boundary: `requestEmailVerification`
and `acceptSafetyContact` sent a POST with `content-type: application/json` and no
body, which Fastify rejects with `400 FST_ERR_CTP_EMPTY_JSON_BODY`. Both now send an
explicit empty JSON object. This was reproduced against the real Fastify app before
the fix.

Validation passed for this milestone:

- focused `api-client` suite: 16 tests;
- workspace lint, typecheck, test (36 mobile files / 144 tests, all packages
  green), build, `verify:maplibre`, and `git diff --check`.

Two validation gaps are open and not waived:

- the four PostGIS API integration tests were skipped because no local PostGIS was
  reachable; they cover server routes this change does not touch, and CI runs them;
- `pnpm format:check` cannot pass in a Windows checkout with `core.autocrlf=true`
  and no `.gitattributes`: every one of the 224 files reports a CRLF style issue.
  Prettier passes on every file this milestone changed, and CI checks out with LF
  endings. Adding a `.gitattributes` that pins `* text=auto eol=lf` would remove
  this trap for Windows contributors.

Separately, `docs/gamification-detailed-plan.md` as committed in `85d3cdb` failed
`prettier --check` on its own content, independent of line endings: headings were
missing the required following blank line. `main` was therefore red at the CI
formatting step. This milestone reformats that file, so the next pull request
should confirm CI formatting is green again.

Milestone 2.2 (rename the `Season` tab placeholder to `Play`) landed next, below.

## Phase 2 milestone 2.2 — Play tab rename, 2026-09-03

The fifth tab is now `Play` instead of `Season`, matching the PRD information
architecture where Play owns challenges and friend standings. The rename covers
`apps/mobile/src/navigation/types.ts`, `navigation/tab-style.ts`,
`navigation/TabBar.tsx`, and `App.tsx`; `SeasonScreen` became `PlayScreen` in
`screens/ProductScreens.tsx`.

`TabBar` previously chose its glyph from a five-branch nested ternary whose final
`else` silently answered for any unrecognized tab. `tab-style.ts` now exports
`tabIcons: Record<Tab, string>`, so a future tab is a type error until it
declares an icon, and a new test pins that every tab has a distinct non-empty
glyph. Play uses `◆`, which frees the retired `⬡` for a later territory surface.

`PlayScreen` is a truthful placeholder, not a preview. It states that challenges
are not live, names what a challenge will count (active minutes, active days,
quest completions) and what it will never count (pace or speed), and presents no
invite, score, standing, or rank — none of which exist until milestones 2.4-2.6.
It also carries the territory disclosure the old Season tab owned, so the
"before first territory season" non-state in `docs/product.md` still has a
surface; that table row now names the Play tab. Play stays a quiet-emphasis tab
alongside Clubs, and milestone 2.4 should promote it to primary when real
gamification UI replaces the placeholder.

Validation passed for this milestone:

- focused mobile `src/navigation` and `src/screens` suites: 7 files, 30 tests;
- mobile lint (0 errors; the 3 remaining `react-hooks/exhaustive-deps` warnings
  are pre-existing and in untouched hooks) and mobile typecheck;
- workspace `typecheck`, `test` (36 mobile files / 145 tests, 17/17 turbo tasks
  green), `build`, `verify:maplibre`, and `git diff --check`.

No new Android device evidence is claimed or needed: the only user-visible
change is a tab label, its icon, and placeholder copy on a screen that makes no
network request. All existing release blockers stay open and unwaived, and
territory, exact live-location sharing, photos, and client-authoritative
validation all remain disabled.

The Windows `pnpm format:check` trap from milestone 2.1 is unchanged: every file
in a `core.autocrlf=true` checkout reports a CRLF style issue. Each file this
milestone touched was verified against Prettier on an LF-normalized copy, and
`docs/product.md` needed its non-state table re-padded after the shorter `Play`
label. A `.gitattributes` pinning `* text=auto eol=lf` would remove the trap and
is still unclaimed work.

Milestone 2.3 (Home progression and weekly-consistency cards over
`GET /v1/progression`) landed next, below.

## Phase 2 milestone 2.3 — Home progression and consistency, 2026-09-03

Home is the first surface to consume the milestone 2.1 gamification client
methods. It now renders a progression card and a weekly consistency card from
`GET /v1/progression`, with the cosmetic tier chip from `GET /v1/profile`.
`apps/mobile/src/screens/home-progression-model.ts` holds every derivation as
pure functions; `HomeScreen.tsx` only fetches and renders.

Placement is deliberate: the cards sit after the free-activity Start card rather
than immediately under the weekly goal, so two cosmetic cards do not push the
screen's one primary action below the fold. Home reads the summary only and never
calls `POST /v1/progression/sync`, which would turn rendering Home into a write.

Reading the served payload surfaced four places where an obvious implementation
would have shown something untrue:

- `ProgressionSummary.level` is optional and exists only while a `progression`
  rule version is published. A missing level renders as an explicit
  `unpublished` state — the XP total plus "Cosmetic levels are not published
  yet" — never a fabricated level 1 or a 0% bar.
- `LevelInfo.nextLevelAt` is the next band's **cumulative** threshold, not a
  remaining delta, so the band width is `nextLevelAt - (totalXp - xpInLevel)`.
  A non-positive width means the served rule and totals disagree; the bar is
  dropped rather than rendered from a divide-by-zero. The render test asserts
  that no `NaN%` or `undefined%` width ever reaches a style.
- `ProgressionSummary.questsCompleted` is still a server stub: the
  `/v1/progression` route hardcodes `0`, so no surface presents it, and a test
  pins that the presentation carries no quest wording. It becomes presentable
  only once the route computes it.
- `weeklyConsistency` reports **how many** days were active, never which ones.
  The card is therefore seven unlabelled count pips rather than a weekday
  calendar, which would have implied days the server never reported. Inactive
  pips use the neutral inset token — never error or warning — nothing is marked
  as missed, and the card closes with "A quieter week never reduces XP you have
  already earned" (ADR-0005). The pip row is one TalkBack node reading
  "3 of 7 active days this week, 182 counted active minutes", with the
  individual pips hidden from the accessibility tree.

Two boundaries were tightened at the same time. A `503` from `/v1/progression`
now maps to a distinct `unavailable` state ("not available on this server yet")
instead of a generic retryable error, and `homeStatusMessage` gained an optional
secondary message so Home keeps exactly one live region: progression announces
itself only when the weekly goal and quest list are both fine. The tier chip is
decoration, so a `404` from `getProfile` — the documented no-profile answer —
leaves the chip off without blocking progression or inventing an identity.

Validation passed for this milestone:

- new `home-progression-model` suite (13 tests) and a new
  `HomeScreen.progression.render.test.tsx` render suite (5 tests) using the
  existing `react-test-renderer` harness;
- focused `src/screens`: 7 files, 40 tests;
- mobile lint (0 errors; the 3 remaining `react-hooks/exhaustive-deps` warnings
  are pre-existing and in untouched hooks) and mobile typecheck;
- workspace `typecheck`, `test` (38 mobile files / 161 tests, 17/17 turbo tasks
  green), `build`, `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies (see the milestone
  2.2 note on the Windows CRLF trap).

No Android device evidence is claimed. Authenticated capture of these cards is
still blocked by the documented authorization-stripping HTTPS tunnel, and the
cards need a published `progression` rule version plus derived activity to show
anything other than the `unpublished` state — importing a rule is part of the
outstanding production setup.

Milestone 2.5 was taken next, out of plan order, so the Play tab is built
against real routes instead of a contract that answers `404`.

## Phase 2 milestone 2.5 — challenge API and scoring worker, 2026-09-03

`/v1/challenges` is live. Milestone 2.4 (the Play tab) was deliberately deferred
behind this so its UI is written against a real server rather than
contract-frozen calls that raise `ApiFailure(404)`.

New in this milestone:

- `infra/postgres/migrations/018_challenges.sql`: `challenges`,
  `challenge_results`, `challenge_participant_results`, a partial unique index
  allowing one live challenge per pair in either direction, and a version-1
  `challenge` rule in `rule_versions`.
- `services/api/src/challenge-routes.ts`: `POST /v1/challenges`,
  `GET /v1/challenges`, `PATCH /v1/challenges/:challengeId`, and
  `GET /v1/challenges/:challengeId/result`, registered in `app.ts`.
- `services/worker/src/challenge-scoring.ts` plus `processNextChallengeFinish`
  in `worker.ts`: the `challenge.finished` sweep, scoring, and fan-out.
- `packages/domain/src/challenge.ts`: `parseChallengeRule`,
  `challengeModeEnabled`, `challengeLengthEnabled`; and in `gamification.ts`
  `challengeWindow`, `challengeWinner`, `kolkataDayStart`, `kolkataDateStart`.
- `ChallengeParamsSchema` in `packages/contracts/src/challenge.ts`. No existing
  challenge contract shape changed; the frozen contract was implementable as
  written.

The invariant the schema exists to protect: **status `finished` implies a stored
`challenge_results` row.** The worker sets `finished` in the same transaction
that writes the result and participant rows, so a finished challenge can never
present an empty or half-computed score. A window that has closed but is not yet
scored answers `409 This result is not ready yet` rather than a zeroed result.

Five decisions worth carrying forward:

- **`quest_completion` cannot be scored, so it is refused.** Nothing in the
  schema records a quest completion — the same gap that makes
  `/v1/progression` return a hardcoded `questsCompleted: 0`. Scoring the mode
  would hand every pair a fabricated 0-0 tie, so the published rule's `modes`
  list omits it, `POST /v1/challenges` answers `422` naming the mode, and the
  worker refuses to score it. **Milestone 2.4 must offer only `active_minutes`
  and `active_days`.** Enabling it is one change: record completions, then
  publish a v2 rule that lists the mode.
- **The window starts when the invite is accepted.** `period_start`/`period_end`
  are proposed at invite time and rewritten exactly once, while the row is still
  `invited`, so a slow reply never costs the invitee scoring days. Invites lapse
  after seven days and the maintenance sweep cancels them, which also frees the
  one-open-challenge-per-pair slot.
- **A tie has no winner.** `winner_account_id` is nullable and a tie is never
  broken on pace, time, or distance — a challenge may not read any of them.
- **Scoring reads the rule version recorded on the challenge**, not the newest
  published one, so a v2 rule never rescores a window under terms the
  participants did not agree to. An unreadable agreed version throws, which
  routes the reason into `outbox_events.last_error` rather than writing a tie.
- **Notice copy carries no score.** Only the opaque challenge id travels, in the
  deep link, so the 014 fan-out to `notification.created` cannot leak a total
  into a push payload (ADR-0009).

Mutual friendship is the authorization boundary and is evaluated together with
blocks in a single statement, so a stranger, a one-way friendship, and a blocked
friend are indistinguishable (ADR-0007). A challenge summary exposes the
opponent's `Profile` only; an opponent with no profile is named "RunSphere
member" rather than by account id. `services/worker` gained a
`@runsphere/domain` dependency (lockfile updated; three added lines).

Validation passed for this milestone:

- new domain `challenge` suite and worker `challenge-scoring` suite; new
  `services/api/src/challenge-routes.test.ts` drives all four routes through
  `app.inject` against a fake `Database`, so real Fastify schema validation and
  authorization run with no PostGIS;
- domain 50 tests, worker 23, API 31 passed + 4 PostGIS integration tests still
  skipped locally, mobile 161;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint`,
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

One pre-existing defect surfaced and was fixed: `services/worker` was the only
workspace package without a `vitest.config.ts`, so after `pnpm build` the
default glob also matched the compiled tests in `dist` and every worker test ran
twice — the second time against stale output that could pass while `src` was
broken. It now uses the `src/**/*.test.ts` include that `services/api`,
`packages/domain`, and `apps/mobile` already had.

The migration has not been applied to any database from this checkout: no local
PostGIS is reachable, so `018_challenges.sql` is verified by review and by the
route/worker tests, not by execution. **Applying it against a real PostGIS and
re-running the four skipped integration tests is the first thing to do in CI or
on a machine with a database.**

Milestone 2.6 was taken next, then 2.4, so the Play tab reads only real routes.

## Phase 2 milestone 2.6 — friend standings API, 2026-09-03

`GET /v1/friends/standings` and `PUT /v1/friends/standings/participation` are
live in `gamification-routes.ts`, with `019_friend_standings.sql` adding
`leaderboard_opt_ins`.

ADR-0007 requires friend boards to use a visibility control **independent** of
activity visibility, so the opt-in is its own table rather than a reuse of
`accounts.profile_visibility`. Absence of a row means not on the board, so the
migration enrols nobody; leaving revokes rather than deletes, keeping the opt-in
auditable. The participation route ships alongside the read route because a read
path with no write path would have left the endpoint permanently empty.

Board rules worth carrying forward:

- **Not on the board means not reading it.** `entries` is empty whenever
  `participating` is false, and the route does not even query for members. The
  opt-in is reciprocal, not a one-way window into friends' numbers.
- Membership requires mutual friendship **and** a live opt-in on both sides,
  minus any block in either direction, evaluated in one statement.
- An entry carries exactly one score: capped weekly active minutes, computed by
  `cappedWeeklyActiveMinutes` in `@runsphere/domain` from the published
  progression rule, so a friend sees the same number the account sees on its own
  Home consistency card. Active days were deliberately not added — ADR-0007
  describes a board entry as carrying one score, and each extra metric is more
  exposure of a friend's week.
- Ties share a rank and the next rank skips (`competitionRanking`, new in
  domain). A tie is never broken, because every available tiebreak would be
  pace, distance, or timing.

Validation: domain 53 tests; API 45 passed + the 4 PostGIS integration tests
still skipped locally, including a new 14-test `friend-standings.test.ts`
driving both routes through `app.inject` against a fake `Database`.

## Phase 2 milestone 2.4 — Play tab, 2026-09-03

`apps/mobile/src/screens/PlayScreen.tsx` replaces the placeholder, with
`screens/play-model.ts` owning every derivation and `play-model.test.ts` plus
`PlayScreen.render.test.tsx` covering them. Play is now a primary-emphasis tab.

Delivered: incoming invites with accept/decline, outgoing invites shown as
waiting on a reply, in-progress challenges, finished challenges with their
stored result, the friend board with join/leave, Loop guidance on the empty
state, and a compose sheet for friend, mode, and duration.

**Two planned features could not be built, because no server data backs them:**

- **"Active challenges with live scores" does not exist.** The worker computes
  scores when the window closes and `GET /v1/challenges/:id/result` answers
  `409` until then, so an in-progress card shows mode, opponent, and days
  remaining, and says scores are counted at the end. A running total would have
  to be derived client-side, which ADR-0005/ADR-0006 forbid. Adding one needs a
  new route **and** a privacy decision about exposing an opponent's in-progress
  total — treat it as its own milestone, not a UI tweak.
- **`quest_completion` is not offered.** No quest completion is recorded
  server-side, so the v1 rule omits the mode and the API answers `422`. The
  compose sheet offers `active_minutes` and `active_days` only.

Building the screen exposed a contract gap milestone 2.5 had not: a
`ChallengeSummary` did not say which side the reader was on, so a client could
not distinguish an invite it must answer from one it sent. `ChallengeSummary`
gained a required `role` (`challenger` | `opponent`) and the route projects it
with a `CASE` on the challenger id. This is exactly the failure mode that
building UI against a `404` contract would have hidden.

Other decisions: declined and cancelled challenges are dropped rather than shown
as history, because nothing was scored; a friend with a live challenge is not
offered in the compose sheet; finished results are fetched at most three at a
time; and a finished window the worker has not scored reads "Counting", never a
zero or a loss.

Validation passed for both milestones:

- mobile 188 tests across 41 files, including 9 `src/screens` files / 67 tests;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint`,
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

Still unverified, and unchanged by this work: no Android device evidence is
claimed, and neither `018_challenges.sql` nor `019_friend_standings.sql` has
been executed against a real PostGIS from this checkout. **Applying both
migrations and running the four skipped integration tests remains the first
thing to do in CI or on a machine with a database.**

Milestone 2.7 (push delivery for `notification.created`) and 2.8 (Loop guidance,
frequency caps, dismissal, and TalkBack polish across the new cards) are what
remain in Phase 2. Both new surfaces already emit inbox rows the worker fans
out, so 2.7 is a delivery-side change rather than a new producer.

## Phase 2 milestone 2.7 — push delivery, 2026-09-04

`services/worker/src/push-delivery.ts` wires `notification.created` to FCM HTTP
v1. `020_push_devices.sql` adds `push_devices` and `push_dispatches`, and
`POST /v1/notifications/devices` plus `DELETE /v1/notifications/devices/:deviceId`
register and revoke an address.

The design decisions, and why they are not UI details:

- **The push is data-only.** It carries the notification id and the deep link
  already stored on the inbox row. A `notification` payload would ask the
  provider to render the title and body — the content ADR-0009 keeps
  server-side. The client reads the entry back from the durable inbox, which
  stays the delivery of record.
- **Registering an address is not consent to be pushed.** `pushDeliveryDecision`
  in `@runsphere/domain` decides, from preferences that already existed:
  channel, then category, then live devices, then quiet hours, then the daily
  cap. Standing "no" answers are checked before timing limits so an audit row
  says _why_ an account was not reached.
- **`push_dispatches` is keyed by notification id.** That single key is both the
  idempotency guard for an outbox retry and the counter the daily cap reads. The
  cap window follows the account's own zone when quiet hours declare one, and
  the Asia/Kolkata day otherwise, matching every other period in the system.
- **A dead address and a transient failure are different.** A provider
  `UNREGISTERED` revokes the row with `revoke_reason = 'provider_unregistered'`
  and is recorded as `suppressed`/`no_devices`; a transient failure throws and
  leaves no dispatch row, so the outbox retries under its existing budget. A
  partial send is recorded as `sent` and not retried.
- **Credentials are all or nothing.** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and
  `FCM_PRIVATE_KEY` must all be present; a half-configured provider would fail
  every event until the attempt budget burned out. Without them the worker logs
  `push.provider_unconfigured` and drains the event. Transactional email stays
  explicitly deferred rather than silently dropped.
- No third-party auth dependency was added: the service-account assertion is
  signed with `node:crypto` and the access token is cached until just before it
  expires.

**Not verified, and it cannot be from here:** no FCM project exists, so no push
has ever been sent. `apps/mobile` has no native token source
(`expo-notifications` is not a dependency), so `registerForPush` reports
`unavailable` today. The client half is complete and tested around an injected
`PushTokenSource`: it persists the registration in SecureStore, skips the network
when the token has not rotated, re-registers when it has, and revokes through
`coordinateLogout` **before** the credentials are cleared — after `auth.clear()`
there is nothing left to authenticate the revoke with.

## Phase 2 milestone 2.8 — Loop guidance and polish, 2026-09-04

`apps/mobile/src/loop-guidance.ts` holds the cue registry and both limits,
`components/LoopCallout.tsx` renders one, and `components/useLoopGuidance.ts`
resolves at most one cue per surface. Six cues ship, each spoken by the crew
member whose role it belongs to:

| Cue                | Crew | Surface                                           |
| ------------------ | ---- | ------------------------------------------------- |
| `pending-result`   | Rho  | activity results, while validation is pending     |
| `weekly-reset`     | Rho  | Home, on a week boundary the reader crossed       |
| `challenge-invite` | Coda | Play, when an invite is waiting on an answer      |
| `play-empty`       | Coda | Play, when nothing is running                     |
| `quest-empty`      | Mira | Explore, when the catalog is empty                |
| `hike-prep`        | Bram | activity preparation, when the movement is a hike |

Rules worth carrying forward:

- **Both limits live in the model, not the screens**, so every surface obeys the
  same discipline: a per-cue daily frequency cap and a dismissal that holds for a
  stated number of days. The cap is charged once, when the cue is first shown,
  rather than on every render — a cap that consumed itself on re-render would
  make a cue flicker away mid-read.
- **One cue per surface.** A screen offers candidates in priority order and shows
  only what the model returns; an invite waiting on the reader outranks an empty
  list.
- **Guidance is never the only route to information.** Every cue restates
  something the surface already shows, so dismissing one loses nothing. That is
  the property which makes a frequency cap safe to have at all.
- **A weekly reset is only news to a client that saw the previous week.** A first
  run records the week and says nothing, so a new account is never told that
  something it never had has reset.
- **Tone is enforced at render.** `LoopCallout` throws on copy that fails
  `isSafeMascotLabel`, the rule Loop and the crew already obey, so a cue claiming
  authority fails loudly rather than shipping quietly.
- Guidance memory is per installation and holds no activity, location, identity,
  or score. Screens reach it through a registry (`setGuidanceStore`), so no
  screen pulls a native secure-storage module into its import graph — which is
  also what keeps the render tests free of native mocks.

TalkBack work in this milestone: each callout is one politely-announced unit
labelled "&lt;speaker&gt; says: …", the mascot inside it is decorative so the message
is not read twice, and dismiss is a separate 48dp control with a hint saying what
dismissing does. Card titles across Home and Play gained
`accessibilityRole="header"` for heading navigation, a challenge heading is read
as one fact rather than three fragments, and a finished result reads as one
outcome. The invite card was deliberately **not** grouped: setting `accessible`
on a container hides its focusable children on Android, and accept/decline must
stay reachable.

This is also the first surface to render the crew at all — `CrewMascot` existed
but no screen used it. The `crew-assets.ts` PNG swap point is unchanged, so the
outstanding artwork blocker still stands and the vector stand-ins are what ship.

Validation for both milestones:

- domain 72 tests; API 56 passed + the 4 PostGIS integration tests still skipped
  locally, including a new 11-test `push-devices.test.ts`; worker 41 tests
  including a new 18-test `push-delivery.test.ts`; mobile 241 tests across 45
  files;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint` (3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors),
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

Unverified and unchanged by this work: no Android device evidence is claimed, and
`018_challenges.sql`, `019_friend_standings.sql`, and `020_push_devices.sql` have
not been executed against a real PostGIS from this checkout. **Applying all three
and running the four skipped integration tests remains the first thing to do in
CI or on a machine with a database.**

Phase 2 is now complete. Phase 3 (Community Beta) is the next scope: clubs CRUD
and relays, opt-in global boards, scheduled competitions, moderation queues,
campaign tooling, and a real Clubs tab.

## Phase 2 milestone 2.9 — surfaces for the shipped social and notification routes, 2026-09-04

Milestones 2.1 through 2.8 left a real gap: the Foundation gate's friends,
blocks, inbox, preference, and achievement routes all shipped and were tested,
`apps/mobile/src/api-client.ts` gained methods for them in 2.1, and **no screen
ever called any of them**. The consequence was not cosmetic:

- **No account could add a friend.** `PlayScreen` read `listFriends()` but
  nothing called `sendFriendRequest`, so on a fresh install the friend board and
  every challenge were unreachable — the two features Phase 2 exists for.
- **No account had a profile.** `GET /v1/profile` answers `404` until a display
  name is set, nothing set one, and `POST /v1/friends/requests` joins
  `profiles` — so a friend request could not have reached anyone even if one
  could be sent.
- **The push preferences the 2.7 worker obeys had no controls**, and the
  `ProfileScreen` head showed a fabricated identity ("Maya Hart", "@mayamoves ·
  Mumbai") of the kind the redesign removed everywhere else.

### What now exists

| Surface                             | Route it finally consumes        |
| ----------------------------------- | -------------------------------- |
| `FriendsScreen` (from the Play tab) | friend requests, friends, blocks |
| `NotificationsScreen` (from You)    | inbox, mark-read, preferences    |
| `AchievementsScreen` (from You)     | achievements, achievement sync   |
| `ProfileIdentityScreen` (from You)  | `GET`/`PUT /v1/profile`          |

Each has a pure model beside it (`friends-model`, `notifications-model`,
`achievements-model`, `profile-model`) holding every derivation, matching the
2.3/2.4 split.

### Decisions worth carrying forward

- **A friend request is never reported as delivered.** The route answers the
  same `202 recorded` for a missing account, an existing friend, a pending
  request, and a block in either direction, so the address cannot be probed
  (ADR-0007). `INVITE_RECORDED_NOTICE` is worded around that, and a test
  asserts the copy contains no "sent", "delivered", "not found", or "exists".
- **No outgoing-request list is shown**, because the API has none:
  `GET /v1/friends/requests` returns incoming pending only. The screen does not
  invent one.
- **A block is only offered where it stays reversible.** Blocking removes the
  friendship and revokes pending requests both ways, so the blocked account
  vanishes from every other list. That is why this milestone added
  `GET /v1/blocks` — a live block list, without the stored reason — and why the
  blocked section renders whenever it has rows.
- **Local email validation exists only to save a rate-limited attempt.** It
  rejects what cannot be an address and claims nothing about who is registered;
  a `429` keeps the typed address so the retry needs no retyping.
- **Entries are marked read because a person opened the screen**, once per
  unread set, never by a background refresh.
- **An inbox entry offers navigation only where it can honestly go.** Today
  that is Play for a `runsphere://challenges/<id>` link and friends for a
  friend request; there is no challenge detail screen to deep-link into, so
  anything else offers no destination rather than a dead end. Friends live
  under Play, so `App` carries a `playEntry` so a friend-request notice in the
  You tab can reach them.
- **Preference saves send only what changed**, so a concurrent edit from
  another device is not silently rewritten, and Save stays disabled until
  something actually differs.
- **The push switch says push is not being delivered yet** on this build and
  that the choice is stored for when it is. Category toggles with no producer
  (clubs, competitions) say so too: a toggle that governs nothing must not
  imply the feature exists.
- **The profile head now shows the account's own display name** or "No display
  name yet", with initials derived from it and a neutral mark when unset. The
  invented person, handle, and city are gone.

### Contract fix this exposed

`NotificationPreferencesUpdateRequest` was `Type.Partial(...)`, which cannot
express _clearing_ quiet hours: `undefined` disappears in JSON and reads as
"unchanged", so the window could be set and never switched off. The schema now
spells `quietHours` out as `QuietHours | null`, the route treats an explicit
`null` as the clear signal, and `notification-preferences.test.ts` covers the
merge, the clear, and the untouched case — none of which had any test before.

Validation:

- API 70 passed + the 4 PostGIS integration tests still skipped locally,
  including a new 6-test `block-list.test.ts` and 8-test
  `notification-preferences.test.ts`; mobile 326 tests across 51 files;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint` (3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors),
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

Unverified: no Android device evidence, and `020_push_devices.sql` (plus `018`
and `019`) still has never run against a real PostGIS from this checkout. A
correction to the earlier gap list: activity history was never actually missing
— the You tab renders `ActivityHistory` above `ProfileScreen`; only its
settings row was mislabelled, and it now reads "Listed above, on this device".

### What is still missing from these surfaces

- **No club or competition producer exists**, so those two preference
  categories govern nothing yet (labelled as such).
- **Marketing consent is not offered here.** It is consent, not a preference,
  and belongs with the campaign tooling in Phase 3.
- **A blocked account cannot be reported.** Reporting, sanctions, and appeals
  are Phase 3 moderation work; there is no reports table.
- **Profile cosmetics are not editable.** `PUT /v1/profile` accepts a
  `cosmetic.avatarKey`, but no catalogue of valid keys is published, so
  offering a picker would invent one.

## Phase 3 milestone 3.1 — clubs, end to end, 2026-09-04

Phase 3's first deliverable: clubs exist, with membership, roles, invite-code
joining, moderation, and archiving — server, domain, and a real Clubs tab in one
milestone. `apps/mobile` no longer shows the "coming later" placeholder.

Built deliberately end to end rather than API-first, because 2.9 had just
finished paying off the cost of the opposite: five Foundation-gate routes shipped
with client methods and no screen, and the friend surface sat unreachable for two
milestones as a result.

### What exists

`021_clubs.sql` adds `clubs` and `club_memberships`. `services/api/src/club-routes.ts`
serves eight routes; `packages/domain/src/club.ts` holds every authority rule;
`apps/mobile/src/screens/ClubsScreen.tsx` and `clubs-model.ts` are the tab.

| Route                                         | What it does                                         |
| --------------------------------------------- | ---------------------------------------------------- |
| `POST /v1/clubs`                              | create; the creator becomes owner in one transaction |
| `GET /v1/clubs`                               | live clubs the caller is an active member of         |
| `POST /v1/clubs/join`                         | join by exact invite code                            |
| `GET /v1/clubs/:clubId/members`               | roster, blocked pairs omitted                        |
| `DELETE /v1/clubs/:clubId/membership`         | leave                                                |
| `DELETE /v1/clubs/:clubId/members/:accountId` | remove a member                                      |
| `PATCH /v1/clubs/:clubId/members/:accountId`  | grant or withdraw `admin`                            |
| `POST /v1/clubs/:clubId/archive`              | archive; ends access for everyone                    |

### Decisions worth carrying forward

- **A non-member gets `404`, never `403`.** A club is invite-code-only, so the
  code is the whole access path; a `403` would confirm that a club id exists.
  An unknown code, a malformed code, and an archived club are also one answer,
  so the join route cannot be used as an oracle for guessing codes.
- **Authority lives in `@runsphere/domain`, not in the route or the screen.**
  `canRemoveMember`, `canChangeRole`, `canLeave`, `canArchive` are pure
  predicates over two roles, and the Clubs tab calls the same ones the route
  enforces — so the UI cannot offer an action the server will refuse.
- **Removal needs strictly greater authority.** An admin cannot remove a fellow
  admin, nobody removes the owner, and removing yourself is not removal but
  leaving, which has its own rule.
- **The owner cannot leave a club that still has members.** There is no silent
  succession: promoting someone automatically would hand a stranger moderation
  powers. A populated club's owner archives it or hands it on. A unique partial
  index (`role = 'owner' AND left_at IS NULL`) makes "exactly one live owner"
  a schema invariant, which is what every domain rule assumes.
- **Nothing is deleted.** Leaving and removal set `left_at` with a reason, and
  a removal names who did it; archiving sets `clubs.archived_at` and leaves the
  membership rows as the audited record of who was in the club.
- **Rejoining reactivates the old row** rather than adding a second one, and a
  removed account may rejoin with the code: removal is not a ban, and bans are
  moderation work that does not exist yet.
- **A block hides two accounts from each other in a club roster too** — the
  same rule as everywhere else — while `memberCount` still reports the club's
  real size, because the size of a club is a fact about the club rather than
  about a person. The tab says so in as many words.
- **Invite codes are generated server-side, never chosen**, from an alphabet
  with `I`, `L`, `O`, `0`, and `1` removed so a code read off a screen cannot
  be mistyped into someone else's club. Codes are compared case-insensitively
  and stored normalized, so the lookup is an equality match on a unique index.
- **Archiving asks twice** and states what it costs first; it is the only
  action in the tab that cannot be undone from the app.
- **The tab shows no relay progress**, because no relay contribution is
  recorded server-side yet: a progress bar with nothing behind it would be a
  fabricated one. It says so, and says a club will only ever see aggregates.

### A deletion gap this closed

`club_memberships` cascades with the account, so erasing an owner would have
left a club with members and nobody able to appoint an admin or archive it. The
worker's `convergeAccountDeletion` now archives clubs the account owns
**before** deleting it, while the membership row proving ownership still
exists; a test asserts that ordering.

Validation:

- domain 91 tests including a new 19-test `club.test.ts`; API 103 passed + the
  4 PostGIS integration tests still skipped locally, including a new 33-test
  `club-routes.test.ts`; worker 42; mobile 364 across 53 files;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint` (3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors),
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

Unverified: no Android device evidence, and `021_clubs.sql` — like `018`, `019`,
and `020` — has never run against a real PostGIS from this checkout. The single
owner index, the invite-code unique index, and the two `left_reason` CHECK
constraints are the parts most worth watching on first apply.

### What Phase 3 still needs

- **Club relays** — a contribution table, capped aggregation in the worker, and
  the progress the tab currently declines to show.
- **Member-only club boards and challenges**, isolated by `club_id`.
- **Global opt-in period boards** — `leaderboard_opt_ins` already carries the
  `global`, `club`, and `competition` scopes; only `friends` has a read path.
- **Scheduled competitions**, **moderation** (reports, sanctions, appeals — a
  blocked or removed member still cannot be reported), **campaign email**, and
  the seven role-gated **admin areas** `gameplay.md` specifies.

## Phase 3 milestone 3.2 — club relays, 2026-09-04

The cooperative half of clubs: one weekly target per club, fed by capped
validated active minutes from every active member. The Clubs tab now shows real
relay progress instead of the note saying relays did not exist.

`022_club_relays.sql` adds `club_relays` and `club_relay_contributions` and
seeds club rule v1. `services/worker/src/club-relays.ts` computes the totals,
two routes read and set them, and `@runsphere/domain/club.ts` holds the caps and
the progress arithmetic.

### Decisions worth carrying forward

- **A club sees aggregates; a member sees aggregates plus their own units.**
  There is no per-member breakdown in the response, and none can be derived
  from the fields that are there — `totalUnits`, `contributorCount`, `myUnits`.
  The internal `club_relay_contributions` row exists so a total is auditable
  and recomputable, and **no route returns one**
  (`safety-and-privacy.md`). `ClubRelayContributionSchema` is now documented as
  the worker's internal record for exactly that reason.
- **The per-member weekly ceiling is what makes a relay cooperative** rather
  than a race. Rule v1 caps 240 minutes a day and 600 a week per member, so a
  club target above ten hours cannot be reached by one person — the club needs
  several people to move rather than one person to move a lot.
- **The worker recomputes rather than increments.** That makes the job
  idempotent (safe on every poll) and self-healing: a late validation, a
  corrected activity, or a deleted one all land correctly on the next pass,
  which an accumulating counter could never do. The replacement is one
  transaction, so a club total is never observed mid-recompute.
- **Only currently active members count.** Someone who left mid-week stops
  contributing from that moment, the same rule access follows, and the
  delete-and-reinsert means their units do not linger in the club total.
- **The settling window is two weeks, not all of them.** The open week plus the
  week just closed are recomputed, because validation is asynchronous and a
  Sunday-evening walk can be validated on Monday. Older weeks are history and
  are never rewritten (ADR-0006).
- **The week is never a parameter when setting a target**, so a week that has
  already been counted cannot be retargeted. `UNIQUE (club_id, period_start)`
  turns a second call into an update rather than a rival relay, so "the club's
  progress" is never ambiguous.
- **Progress is clamped at 100%.** A club that passes its target has met it,
  not exceeded it: there is no league table of clubs and no reward for
  overshooting, so an unclamped number would only invite comparison.
- **An out-of-range target is a `422`, not a `400`.** The request is
  well-formed; the published rule simply does not allow it — or no relay rule
  is published on this deployment, which the route says rather than inventing a
  default target.
- **A freshly created relay honestly reads zero** until the worker runs, because
  the route does not compute totals.

Validation:

- domain 103 tests (12 more in `club.test.ts`); API 114 passed + the 4 PostGIS
  integration tests still skipped locally (11 more in `club-routes.test.ts`);
  worker 51 (a new 9-test `club-relays.test.ts`); mobile 386 across 53 files;
- workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint` (3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors),
  `verify:maplibre`, and `git diff --check`;
- Prettier verified per changed file on LF-normalized copies.

Unverified: no Android device evidence, and `022_club_relays.sql` — like `018`
through `021` — has never run against a real PostGIS. The `period_end =
period_start + 7` CHECK, the `UNIQUE (club_id, period_start)`, and the club
rule-v1 seed are what to watch on first apply. **No relay has therefore ever
been computed against real activity**: the aggregation is covered by unit tests
with a fake database only.

### What Phase 3 still needs

- **Member-only club boards and club challenges**, isolated by `club_id`. The
  tab says they are not built yet.
- **Global opt-in period boards** — `leaderboard_opt_ins` already carries the
  `global`, `club`, and `competition` scopes; only `friends` has a read path.
- **Scheduled competitions**, **moderation** (reports, sanctions, appeals),
  **campaign email**, and the seven role-gated **admin areas**.
