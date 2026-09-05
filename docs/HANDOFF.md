# RunSphere implementation handoff

Updated: 2026-09-05
Baseline: `main` at `74fff93`. Phase 2 milestones 2.1 through 2.9 and Phase 3
milestones 3.1 (clubs) and 3.2 (club relays) are committed on `main`. Phase 3
milestones 3.3 (club boards), 3.4 (club challenges), 3.5 (global boards),
3.6 (scheduled competitions), 3.7 (moderation), 3.8 (sanction enforcement), and
3.9 (campaign email), 3.10 (the operations console), 3.11 (sanction
management), 3.12 (privacy and data-stewardship reads), and Phase 4 milestones
4.1 (season enrollment and divisions) and 4.2 (the traversal and control
engine, written and switched off) are implemented and validated locally but are
**not yet committed**; they need a fresh `vorflux/*`
branch and a new pull request targeting `main`, because merged PRs #6 and #8
cannot receive later commits. Every member-facing surface in Phase 3 now
exists, sanctions are enforced and fully manageable, campaign email is built
behind a provider that is not configured, and six of the seven console areas
are real. What remains: the support area (waiting on a privacy review), an
email provider, and **a database run** — 3.12 found a migration defect that
would have failed on first apply, which is the first hard evidence that the
"never applied against PostGIS" caveat has teeth.
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

## Phase 3 milestone 3.3 — club boards, 2026-09-05

The competitive half of clubs. `GET /v1/clubs/:clubId/board` ranks the members
of one club who joined the board by this week's capped validated active
minutes, and `PUT /v1/clubs/board/participation` opens or revokes the `club`
scope in `leaderboard_opt_ins`. The Clubs tab shows the board where its footer
used to say boards did not exist.

No migration: `019_friend_standings.sql` already carries the `club` scope, and
its own comment says a later phase should add a row kind rather than a second
table. Nothing in `@runsphere/domain` needed a new predicate either — the board
reuses `cappedWeeklyActiveMinutes`, `competitionRanking`, and `visibleToMember`,
which is the point of them being pure.

### Decisions worth carrying forward

- **Two gates stand in front of an entry list**, and both are enforced in the
  route rather than in the query alone: active membership of that club, and the
  reader's own live opt-in. Reading other members' scores without publishing
  your own is the asymmetry the friend board already refuses, and a club is a
  smaller room, not a different rule.
- **A non-member is answered `404`**, the same answer as for a club that does
  not exist, so the board is not an oracle for club ids any more than the
  roster or the join route are.
- **A block hides two accounts from each other on a board as in a roster**, and
  the blocked member is not scored either — they are filtered before the score
  query runs, so their account id never even reaches it.
- **A board entry is the friend board's projection, unchanged**: display
  identity, one published pace-neutral score, a rank. Reusing the shape is
  deliberate — a board entry means the same thing wherever it is read, and a
  club board is a board with a narrower audience rather than a different kind of
  disclosure (ADR-0007).
- **The board publishes a per-member score where the relay deliberately does
  not.** That is the whole difference between them: relay minutes are counted
  whether or not you asked, so they stay aggregate forever; a board score is
  opt-in, off by default, and revocable. `safety-and-privacy.md` reads
  consistently with both.
- **The score is the published progression rule's capped weekly active-minute
  total**, computed by `@runsphere/domain`, so the number on the board and the
  number on the reader's own Home consistency card can never disagree.
- **With no published progression rule the board is empty**, not a column of
  zeroes. An empty board is the honest answer; a fabricated tie is not.
- **Participation is one account-level decision covering every club the account
  is an active member of**, which is why no club id appears in that path — the
  route cannot then read as a per-club promise it does not keep. A club is
  private and member-only, so the audience is already bounded by the rooms the
  member chose to join, and a per-club switch would publish the same score to a
  strictly smaller audience while doubling the controls to reason about. It is
  independent of the `friends` scope and of activity visibility (ADR-0007).
- **Leaving revokes rather than deletes**, so the opt-in history stays auditable
  and re-joining reopens the same row. Both directions are audited
  (`club_board.joined`, `club_board.left`).
- **The tab reloads the board after joining or leaving** rather than flipping a
  local flag, so what it shows is what the server will now return.

### A stale promise this removed

The Clubs tab footer said "Club boards and club challenges are not built yet."
Half of that is no longer true, so it now names only club challenges. A tab that
keeps saying a feature does not exist while showing it is worse than one that
never mentioned it.

Validation:

- API 126 passed + the 4 PostGIS integration tests still skipped locally (11 new
  in `club-routes.test.ts`); mobile 398 across 53 files (12 new, split between
  `clubs-model.test.ts` and `ClubsScreen.render.test.tsx`); domain 103, worker
  51, contracts 11 — all unchanged, as no domain rule changed;
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified: no Android device evidence, and no board has been computed against a
real database — the ranking is covered by unit tests with a fake database only.
`019_friend_standings.sql` has still never run against a real PostGIS, so the
`club` scope value in its CHECK constraint is what to watch on first apply.

### What Phase 3 still needs

- **Club challenges**, member-only and isolated by `club_id`. The tab now says
  only this is missing.
- **Global opt-in period boards** — `leaderboard_opt_ins` now has read paths for
  `friends` and `club`; `global`, `competition`, and `territory` still have none.
- **Scheduled competitions**, **moderation** (reports, sanctions, appeals),
  **campaign email**, and the seven role-gated **admin areas**.

## Phase 3 milestone 3.4 — club challenges, 2026-09-05

The last unbuilt club surface, and the third shape a club can take: the relay
is cooperative, the board is a standing weekly ranking, and a challenge is a
time-boxed contest with a start, an end, and a stored result.

`023_club_challenges.sql` adds `club_challenges`, `club_challenge_participants`,
and `club_challenge_results`, and seeds `rule_versions.kind = 'club_challenge'`
v1 in the same shape as the 1v1 rule — so `parseChallengeRule`,
`challengeWindow`, and `challengeModeScore` read both and the two can never
drift into scoring the same minutes differently. Five routes in
`club-routes.ts`, one worker module in `club-challenges.ts`, and a Clubs tab
section that opens, joins, ranks, and cancels.

### Decisions worth carrying forward

- **Two consents, kept apart.** Opening a contest is a club-wide act and needs
  owner or admin authority (`canManageClubChallenge`); joining publishes _your_
  score, so it is yours alone to give and to revoke. Opening one therefore
  enrols nobody — not even the member who opened it — and there is a test for
  exactly that.
- **One live challenge per club**, enforced by a partial unique index rather
  than by a check in the route. `INSERT ... ON CONFLICT (club_id) WHERE status
= 'active' DO NOTHING` turns the race into a clean `409`, and a member is
  never asked which of two contests their minutes count toward.
- **The window is derived, never requested.** A contest starts the Kolkata day
  it was opened and runs the published length, so it can neither be backdated
  over days that already happened nor parked in the future.
- **Joining is retroactive within the window, and the UI says so before you
  join.** Everyone in a contest is scored over the same days; a contest where
  each person's clock started when they opted in would rank the moment someone
  decided to join rather than how much they moved. That is the one thing about
  this feature a member could otherwise be surprised by, so
  `CLUB_CHALLENGE_JOIN_CONSEQUENCE` states it at the point of the decision.
- **Leaving records a departure rather than deleting the row**, and from that
  moment the member is neither scored nor shown. Leaving the club does the same
  thing — the worker's participant query joins live membership — which is the
  rule every other club read follows.
- **Standings are gated on the reader's own participation**, exactly as the club
  board is gated on its opt-in: reading the other participants' scores means
  having published your own.
- **Live while open, stored once closed.** The API computes a provisional
  standing for an open window and reads `club_challenge_results` for a closed
  one, so a finished contest reads the same to everyone forever (ADR-0006). The
  `final` flag in the response is what tells the client which it is looking at.
- **A contest is scored under the rule version it was opened with**, even after
  a newer rule is published, so nobody is rescored under rules they did not
  join. An unreadable rule leaves the challenge active for a human rather than
  finishing it with invented scores.
- **Cancelling writes no result at all**, so a contest that was called off never
  becomes a record anyone is ranked in. It is the moderation escape hatch for a
  challenge that should not have been opened.
- **No outbox row in the worker.** The `status = 'active'` claim inside the
  finishing transaction _is_ the idempotence: a failed pass leaves the challenge
  active and the next sweep retries, and an already-scored challenge is not
  selected. That is simpler than the 1v1 outbox flow and self-heals the same
  way the relay recompute does.
- **The finish notification reuses the existing `challenge_finished` kind**
  rather than adding one to the `notification_inbox` CHECK constraint. It maps
  to the same "challenges" preference category a 1v1 result uses, which is the
  toggle a member would expect to govern it, and the body carries neither score
  nor rank so a push payload cannot leak one.
- **An archived club's challenges are never scored.** Nobody can open the club,
  so a result no one can read would be written for nothing; the contest stays
  active, which is truthful — it never concluded.

Validation:

- domain 107 (4 new in `club.test.ts`); API 147 passed + the 4 PostGIS
  integration tests still skipped locally (21 new in `club-routes.test.ts`);
  worker 63 (a new 12-test `club-challenges.test.ts`); mobile 416 across 53
  files (18 new);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors), and
  `verify:maplibre`;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified: no Android device evidence, and no club challenge has ever been
scored against a real database — the standings and the finish are covered by
unit tests with a fake one. `023_club_challenges.sql` has never run against a
real PostGIS: what to watch on first apply is the `club_challenges_open_idx`
partial unique index (the create route's `409` depends on it), the `period_end =
period_start + length_days` CHECK, and the `club_challenge` rule seed.

### What Phase 3 still needs

Every club surface in the phase now exists. What remains is outside clubs:

- **Global opt-in period boards** — `leaderboard_opt_ins` now has read paths for
  `friends` and `club`; `global`, `competition`, and `territory` have none.
- **Scheduled competitions**, **moderation** (reports, sanctions, appeals),
  **campaign email**, and the seven role-gated **admin areas** in `apps/admin`,
  which is still a skeleton.

## Phase 3 milestone 3.5 — global boards, 2026-09-05

The first board outside a private room. Friends and clubs are rooms somebody
let you into; global is everyone who opted in, which is why it is the scope
with the least in it and the most gates in front of it.

`024_global_boards.sql` adds `global_board_entries` and seeds global-board rule
v1. `services/worker/src/global-boards.ts` materializes the week,
`services/api/src/global-board-routes.ts` serves the read and the opt-in, and
the Play tab shows the board under friend standings.

### Decisions worth carrying forward

- **The board is materialized, not computed on read.** Ranking every opted-in
  account per request would scan the activity history of everyone on the board;
  instead the worker recomputes the open week and the week just closed, and a
  read is one indexed page of one division. PostgreSQL stays authoritative and
  the table is rebuildable from activity at any time (`gameplay.md`), which is
  what keeps a cache out of the critical path rather than inviting Redis in
  ahead of the cost gates in ADR-0010.
- **Divisions are published activity-history bands, not skill ratings.** A
  division comes from how many earlier Kolkata weeks an account was active — a
  count of weeks, never a score, a pace, or a place — so a first week is never
  ranked against a fiftieth (`product.md` newcomer treatment). The bands live in
  `rule_versions`, so changing them is a rule publish rather than a deploy.
- **A division is recomputed per period rather than carried**, so nobody is
  stuck in a band they have grown out of, and the stored `division` column keeps
  a finished week readable under the bands it was actually scored with.
- **An account that did not move is absent, not ranked at zero.** `minScore` is
  what makes the board worth reading: a column of names against zero publishes
  participation and nothing else.
- **Reading requires being on it**, the same reciprocity the friend and club
  boards use.
- **A block leaves a gap in the visible ranks rather than renumbering them.**
  The rank an account holds is a fact about the period, not about who is
  looking; renumbering per reader would make two people's screenshots of the
  same board disagree.
- **The reader's own standing is a rank and a score, with no profile.** They
  already know who they are, so `me` carries no second copy of their display
  identity. This also kept the response free of a duplicated `Profile` `$id`,
  which Fastify's serializer rejects outright — worth remembering the next time
  a response wants the same nested schema twice.
- **Leaving takes effect immediately.** The route revokes the opt-in _and_
  deletes the account's rows from the open week onward, rather than waiting for
  the next sweep. An opt-out that is still visible for hours is not an opt-out.
  Closed weeks are never rewritten (ADR-0006), so the deletion is bounded to
  `period_start >= this week`.
- **The sweep runs the global board last**, after deletions, departures, and the
  club jobs have settled, so a full recompute over the widest set of accounts
  reflects everything that changed in the same pass.

Validation:

- domain 116 (9 new in `global-board.test.ts`); API 157 passed + the 4 PostGIS
  integration tests still skipped locally (10 new in
  `global-board-routes.test.ts`); worker 74 (a new 11-test
  `global-boards.test.ts`); mobile 427 across 53 files (11 new);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

One failure seen and not reproduced: `friend-standings.test.ts` failed once
during a fully parallel `turbo run typecheck test build lint`, with every file in
that run taking 14s or more, and passed on its own and on a rerun of the whole
API suite. **Corrected 2026-09-05 — see "The timeout failures were
self-inflicted" below.** This was not a property of the test suite: full runs
were being launched in the background while other heavy commands ran against the
same machine.

Unverified: no Android device evidence, and no board has been materialized
against a real database — the ranking and the division bands are covered by unit
tests with a fake one. `024_global_boards.sql` has never run against a real
PostGIS: what to watch on first apply is the seeded `global_board` rule and the
`date_trunc('week', processed_at AT TIME ZONE 'Asia/Kolkata')` history query,
which is the one piece of division logic that lives in SQL rather than in
`@runsphere/domain`.

### What Phase 3 still needs

- **Scheduled competitions** — opt-in, time-boxed, with a published rule
  version, eligibility, window, rewards, and a dispute period. The
  `competition` leaderboard scope and `packages/contracts/src/competition.ts`
  both exist and have no read path.
- **Moderation** — reports, sanctions, appeals. Blocking ships; reporting does
  not, so a blocked account still cannot be reported.
- **Campaign email** and the seven role-gated **admin areas** in `apps/admin`,
  which is still a skeleton.

## Phase 3 milestone 3.6 — scheduled competitions, 2026-09-05

The most formal contest in the product: announced in advance, with a published
rule version, stated eligibility, a fixed window, cosmetic-only rewards, and a
dispute period. It is also the first thing in the product an ordinary member
cannot create — staff schedule it, and everyone enters themselves.

`025_competitions.sql` adds `competitions`, `competition_enrollments`, and
`competition_results`, and seeds competition rule v1 in the same shape as the
1v1 and club challenge rules, so one parser and one set of scoring functions
now read all three. `competition-routes.ts` serves three member routes and two
staff routes; `competitions.ts` in the worker advances the lifecycle; the Play
tab lists, enters, and shows standings.

### Decisions worth carrying forward

- **A competition is created as a draft.** An announcement is a commitment —
  people arrange their weeks around it — so publishing is a second, deliberate
  act rather than a side effect of typing a title. Publishing is one-way: only
  a draft can be announced, so an event people may already have entered cannot
  slip back into being unannounced.
- **A cancelled event stays visible.** It was announced; quietly removing it
  would erase a fact participants are owed. It simply never has a result.
- **Eligibility is published, enforced, and stated either way.** The band is a
  count of earlier active weeks — the same history band the global board's
  divisions use, never a score, a pace, or a place — and the UI states it
  whether or not the reader clears it. A rule that appears only when it excludes
  you reads as a rejection. The `403` names the band rather than hiding the
  event, because the event was announced to this account.
- **Withdrawing is never gated on eligibility.** Leaving is always available,
  even to somebody who would no longer qualify to enter.
- **Entering scores the whole window, however late you enter**, because every
  participant is measured over the same days. Stated at the point of entry.
- **The clock, not a person, moves a competition.** `competitionStatusDue` is a
  pure predicate: published → open at the window's start, open → closed at its
  end, closed → finalized once the stated dispute period has elapsed. A window
  that opened _and_ closed while nobody swept lands straight on `closed` rather
  than opening for a day that is already gone, and nothing ever revives a
  cancelled or finalized event.
- **Results are written once, in the transaction that closes the event**, and
  are flagged `provisional` until the dispute period elapses. Finalizing records
  that the span passed; it rescores nothing (ADR-0006). The `status IN
('published','open')` claim in that update is the idempotence, so a failed
  sweep simply retries.
- **A cancelled competition writes no result at all**, so nobody is ever ranked
  in an event that was called off.
- **The close notification says the result is provisional**, carries neither
  score nor rank, and uses the existing `competition` inbox kind.
- Staff work is audited to `staff_audit_events` (`competition.drafted`,
  `.published`, `.cancelled`); member entry and withdrawal to
  `privacy_audit_events`.

Validation:

- domain 129 (13 new in `competition.test.ts`); API 181 passed + the 4 PostGIS
  integration tests still skipped locally (24 new in
  `competition-routes.test.ts`); worker 86 (a new 12-test `competitions.test.ts`);
  mobile 443 across 53 files (16 new);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

### A test-harness fix worth knowing about

`PlayScreen.render.test.tsx` mocked `PrimaryButton` as a `Text` that dropped
`onPress`, so no test in that suite could ever press one — a control could have
been wired to nothing and the suite would still have been green. The mock now
renders a real pressable with the accessible name, and the competition tests
press it the way a person would. If a Play-tab button ever looks untested, this
is why.

### The timeout failures were self-inflicted

**Corrected 2026-09-05.** Read the note under milestone 4.2 first — this
section's original diagnosis was wrong.

Running `turbo run typecheck test build lint` made one or two API tests fail
with `Error: Test timed out in 5000ms` — seen on `friend-standings.test.ts` and
`block-list.test.ts`, both of which pass in isolation and in a serial API run,
and neither of which the milestone touched. The original conclusion recorded
here was "machine contention, not a defect, raise `testTimeout`". The first half
was right and the second was the wrong remedy: the contention was **caused by
running other heavy commands concurrently with a backgrounded full run**, not by
the suite itself. A `testTimeout` bump would have masked a scheduling mistake and
blunted a real slowness signal. Run the full verification alone.

Unverified: no Android device evidence, and no competition has ever run against
a real database — the lifecycle, scoring, and eligibility are covered by unit
tests with a fake one. `025_competitions.sql` has never run against a real
PostGIS: watch the `period_end > period_start` CHECK, the status CHECK, and the
seeded `competition` rule on first apply.

### What Phase 3 still needs

- **Moderation** — reports, sanctions, appeals. Blocking ships; reporting does
  not, so a blocked account still cannot be reported. This is the last member-
  facing gap in the phase.
- **Campaign email** and the seven role-gated **admin areas** in `apps/admin`,
  which is still a skeleton. The competition staff routes added here are the
  first role-gated surface with no admin UI in front of them.

## Phase 3 milestone 3.7 — moderation, 2026-09-05

Reports, sanctions, and appeals. This closes the gap the plan has carried since
2.9 in one line: **blocking shipped, reporting did not, so a blocked account
could not be reported.** Now it can, from the same row.

`026_moderation.sql` adds `reports`, `sanctions`, and `sanction_appeals`.
`moderation-routes.ts` serves three member routes (file a report, read your own
standing, appeal) and four staff routes (report queue, resolve, appeal queue,
decide), gated on `moderator`/`admin`. The worker closes out expired sanctions.
On mobile, Report sits beside Block on the Friends screen — including in the
blocked list — and the You tab gained a "Your standing" section.

### Decisions worth carrying forward

- **A reporter is told the report was received, and nothing else.** No status,
  no outcome, no reference to the subject. An answer that varied by outcome, or
  by whether the subject exists, would turn reporting into a lookup — so the
  response is a fixed acknowledgement, and it says out loud that no update is
  coming, so nobody waits for one.
- **A second report on the same subject is folded into the first.** Refusing
  would both disclose state ("you already reported this") and discourage
  somebody from raising something that got worse. The partial unique index
  keeps the queue to one open row per reporter per subject.
- **Reporting never consults blocks.** Hiding somebody does not revoke your
  ability to raise what they did, and the test asserts the block table is never
  read on that path.
- **A sanction is written for the account that receives it**, and the resolve
  route refuses to issue one without that statement. A punishment nobody can
  read is not moderation.
- **A `social_suspension` removes only the sharing surfaces** — boards, clubs,
  challenges, competitions — and leaves recording, history, and export
  untouched. Somebody's own activity data is theirs; withholding it would aim
  the punishment at the wrong thing. Only `account_suspension` stops the
  account being used, and only it may be indefinite with an expiry.
- **A club cannot be sanctioned from a report.** A club-wide punishment hits
  every member for one person's name; a club is moderated by acting on the
  owner or by archiving it.
- **One appeal per sanction, only while it still applies**, answered with a
  reason. An expired sanction cannot be appealed because arguing against
  something that has already ended is busy work for both sides.
- **An overturned appeal revokes the sanction in the same transaction**, so a
  lifted sanction is never briefly still in force. "Upheld" means the _sanction_
  stands — the vocabulary is from the appellant's side, and the mobile copy is
  written so it can never read as a win.
- **A sanction record never disappears.** Expired and revoked ones stay listed:
  a record that vanishes when it ends cannot be checked or answered.
- **Expiry is recorded at the stated time, not at sweep time.** The worker sets
  `revoked_at = expires_at`, so an account was free from the moment its
  sanction ended rather than from whenever the worker noticed.
- Staff work is audited to `staff_audit_events` — including _reading_ a queue,
  since who looked at a report is part of the record. Member-side reporting is
  audited against the reporter's own account, never the subject's.

Validation:

- domain 144 (15 new in `moderation.test.ts`); API 208 passed + the 4 PostGIS
  integration tests still skipped locally (27 new in
  `moderation-routes.test.ts`); worker 88 (2 new); mobile 458 across 54 files
  (15 new, in `moderation-model.test.ts` and `FriendsScreen.render.test.tsx`);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors) — this run had
  no timeout failures;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified: no Android device evidence, and no report, sanction, or appeal has
ever run against a real database. `026_moderation.sql` has never run against a
real PostGIS: watch the `reports_open_unique_idx` partial unique index (the
fold-into-first `ON CONFLICT` depends on it), the `reporter_account_id <>
subject_id` CHECK, and the `UNIQUE (sanction_id)` that enforces one appeal.

**Enforcement is not wired yet, and this matters.** `sanctionBlocksSharing` and
`sanctionBlocksSignIn` are pure predicates with tests, but no route consults
them: a `social_suspension` is currently a statement in the sanctioned
account's settings rather than something that stops a board entry appearing.
Wiring them into the board, club, challenge, and competition read paths — and
into sign-in for `account_suspension` — is the first thing the next milestone
should do, before any of this is described to a user as enforcement.

### What Phase 3 still needs

- **Enforcement of sanctions** in the read paths and at sign-in, as above.
- **Campaign email** — consented drafting, scheduling, sending, and
  unsubscribe.
- **The seven role-gated admin areas** in `apps/admin`, still a skeleton. Three
  milestones have now added staff routes (competitions in 3.6, the report and
  appeal queues here) with no UI in front of them, so a moderator today needs
  an HTTP client.

## Phase 3 milestone 3.8 — sanction enforcement, 2026-09-05

3.7 left an honest gap in its own handoff: sanctions were recorded and shown to
the account, but no route consulted them, so a "sharing paused" was a sentence
in a settings screen rather than something that stopped anything. This closes
it. No migration and no new contract — this milestone is entirely about the
predicates from 3.7 finally being read.

`services/api/src/sanction-guard.ts` is the one place that decides what a
suspension stops, so "what does a social suspension actually do" has a single
answer the routes, the worker, and the tests all share.

### Decisions worth carrying forward

- **Two shapes of enforcement, deliberately separate.** `requireSharingAllowed`
  refuses _your own_ publishing acts; `notSharingSuspended` is a SQL fragment
  that drops you from _other people's_ views. Only doing the first would leave a
  suspended account on every board it had already joined — which is not a pause
  of anything.
- **The refusal carries the statement staff wrote.** A `403` with the words of
  the decision is the difference between moderation and a wall, and the mobile
  notices now pass a `403` through verbatim instead of flattening it to
  "something went wrong".
- **Leaving is never guarded.** Withdrawing from a competition, leaving a club
  challenge, leaving a board — all stay available under any sanction. A paused
  account is never trapped in something it cannot leave.
- **A warning changes nothing**, and a sharing suspension never touches
  recording, history, export, club membership, or reading. What is paused is
  being published to other people, and nothing else.
- **Sign-in is refused only after the password checks out.** Answering earlier
  would make sign-in a way to test whether somebody else has been suspended.
  Refresh is checked too — with the family revoked on the way out — so a
  suspension applied mid-session lands at the next rotation instead of waiting
  for a sign-out.
- **The guard runs before the lookup.** A friend request is refused before the
  address is read, and a club join before the invite code is resolved, so a
  refusal discloses nothing about anybody else — and a paused account cannot use
  the join route as a code oracle.
- **The global board's filter lives in the recompute**, not only in the read.
  Because the worker rebuilds two weeks from scratch, a suspension takes effect
  on the next pass without anything having to go back and delete rows.
- **`SHARING_SUSPENDED_KINDS` is derived from the kinds themselves**
  (`SANCTION_KINDS.filter(sanctionBlocksSharing)`), so adding a sanction kind
  cannot leave the enforcement paths behind.

### Enforcement points, in full

Guarded acts: global / club / friend board opt-in, club challenge join,
competition entry, 1v1 challenge creation, club create, club join, friend
request. Filtered views: friend standings, club board, club challenge
standings, competition standings, global board (route page _and_ worker
recompute). Sign-in: `POST /v1/auth/login` and `/v1/auth/refresh`.

Validation:

- domain 150 (6 new in `moderation.test.ts` for `restrictionsFor`); API 228
  passed + the 4 PostGIS integration tests still skipped locally (20 new, most
  in a new `sanction-enforcement.test.ts` that drives every guarded route and
  asserts both halves: the refusal _and_ that leaving still works); worker 89 (1
  new); mobile 459 (1 new);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

One timeout failure recurred (`turbo run typecheck test build lint` with Metro
bundling in flight; the API suite passes serially every time). **Corrected
2026-09-05:** this was recorded here as an unexplained flake and a case for a
`testTimeout` bump. It was neither — the full run was competing with other
commands issued against the same machine while it ran. No config change is
needed; run the full verification alone.

Unverified: no Android device evidence, and none of this has run against a real
database — enforcement is covered by unit tests with a fake one, including the
SQL fragments, which are asserted as text rather than executed.

### What Phase 3 still needs

- **Campaign email** — consented drafting, scheduling, sending, unsubscribe.
- **The seven role-gated admin areas** in `apps/admin`, still a skeleton. Four
  milestones have now added staff routes (competitions, the report queue, the
  appeal queue) with no interface in front of them.
- **A staff route to list or lift an account's sanctions** outside the appeal
  flow. Today an early lift means a database change, which is the one moderation
  action with no audited path.

## Phase 3 milestone 3.9 — consented campaign email, 2026-09-05

Marketing email is the only thing RunSphere sends that nobody asked for at the
moment it arrives, so almost every decision here is about consent being real
rather than assumed.

`027_email_campaigns.sql` adds `email_templates`, `email_campaigns`,
`email_campaign_recipients`, and `email_unsubscribe_tokens`.
`campaign-routes.ts` serves four staff routes and a public unsubscribe;
`campaigns.ts` in the worker resolves audiences and queues recipients; the
notification settings screen gained the toggle that makes any of it reachable.

### The dormant column this woke up

`notification_preferences.marketing_consent` has existed since 011 and had
never been read or written by a single route — a consent flag nothing consulted
and nobody could set. It is now the authoritative flag, wired through the
contract, the preferences route, and the mobile screen, and recorded in
`consent_history` on every change. Worth knowing: this is why the preferences
contract gained a field, and why several existing tests needed a new key.

### Decisions worth carrying forward

- **Consent is all three switches**: `marketing_consent`, the `marketing`
  category, and the `email` channel. Requiring all three means no single
  forgotten toggle can put mail in an inbox — and the mobile control sets and
  clears all three together, because a member who says yes means yes, not "yes,
  if two other toggles elsewhere also happen to be on".
- **A campaign references a reviewed template version**, resolved and recorded
  when it is scheduled. Editing the template afterwards cannot change what a
  scheduled send contains.
- **A campaign manager sees counts, never people.** The preview is three
  integers, and no route in the file returns an account id, a display name, or
  an address. The campaign tool cannot become an export of who consented.
- **The audience is re-resolved at send time**, not carried from the preview, so
  somebody who unsubscribed in between is simply absent — nothing has to
  remember to remove them.
- **An audience dimension nothing records is refused.** The contract allows
  locale, app version, and feature cohort; this deployment stores none of them,
  and an audience built on an attribute nobody records would quietly match
  everybody or nobody. A `422` naming the reason beats either surprise.
- **A recency band must be at least 7 days.** Narrower than that it stops being
  a cohort and becomes "who opened the app yesterday" — behavioural targeting by
  another name. The band reads only _that_ an activity exists, never what it
  was: no distance, no pace, no place.
- **Unsubscribe needs no session**, answers identically whatever the token was
  (so it cannot be used to test tokens or confirm an address), and clears all
  three switches. The token is stored hashed and **never reissued**, so the link
  in an email already sent keeps working.
- **Scheduling needs 15 minutes of lead time**, so a mistyped date cannot send
  on the next sweep before anybody can cancel it.
- **Cancelling works right up until the send finishes** and drops anything still
  queued; a `sent` campaign answers `409` rather than pretending it can be
  recalled.

### What is deliberately not here

Delivery. No email provider is configured (ADR-0010 gates it), so a queued
recipient stays `queued` — visibly, in a row somebody can count — rather than
being marked sent by a worker that sent nothing. One outbox event is enqueued
per campaign rather than per recipient, because thousands of undeliverable
events would be noise rather than work; the recipients table is the list. This
is the same shape push took before FCM credentials existed, and the handler is
the only thing that changes when a provider lands.

Validation:

- domain 162 (12 new in `campaign.test.ts`); API 252 passed + the 4 PostGIS
  integration tests still skipped locally (24 new across `campaign-routes` and
  `notification-preferences`); worker 98 (9 new in `campaigns.test.ts`); mobile
  464 (5 new);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors) — no timeout
  failures this run;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified: no Android device evidence, and nothing has run against a real
database. `027_email_campaigns.sql` has never run against a real PostGIS: watch
the `email_templates_live_idx` partial unique index (one live version per key),
the `token_hash` format CHECK, and the `status <> 'scheduled' OR scheduled_for
IS NOT NULL` CHECK.

### What Phase 3 still needs

- **An email provider**, before any of this sends anything. Until then a
  campaign reaches `sending` and queues rows; that is the honest state, not a
  bug to fix in the worker.
- **A template authoring path.** `email_templates` has no route: today a
  template is inserted by hand, so scheduling any campaign on a fresh database
  answers `422` until somebody writes one in SQL. That is the next gap to close
  in this area.
- **The seven role-gated admin areas** in `apps/admin`, still a skeleton. Five
  milestones have now added staff routes with no interface in front of them.
- **A staff route to lift a sanction** outside the appeal flow.

## Phase 3 milestone 3.10 — the operations console, 2026-09-05

Five milestones had shipped staff routes with nothing in front of them:
competitions in 3.6, the report and appeal queues in 3.7, campaigns in 3.9.
Running any of it meant an HTTP client. `apps/admin` is now a console — sign
in, read your roles, operate exactly what those roles allow.

It also closed the gap 3.9 left: `POST /v1/staff/email-templates` publishes
template versions, so scheduling a campaign no longer requires inserting a row
by hand.

### Decisions worth carrying forward

- **The console gates on the server's own predicates.** `areas.ts` imports
  `canModerate`, `canOperateCompetitions`, and `canManageCampaigns` from
  `@runsphere/domain` — the same functions the routes call. The console cannot
  drift into offering an action the API refuses, or hiding one it allows,
  because there is only one definition of each.
- **An area with no route says what is missing and why.** Privacy requests,
  data stewardship, and support render a named reason instead of an
  operational-looking screen. A console that appears to work and quietly does
  nothing is worse than one that admits the gap.
- **Support says its own blocker out loud**: an account-lookup route needs a
  privacy review first, because a console that can find any account by email is
  the most sensitive surface in this product. That is a decision to make
  deliberately, not to discover mid-implementation.
- **Activity review is offered to any signed-in staff account**, because that
  route predates RBAC and is allow-listed by account id in API config rather
  than by a role. The area note says so, so nobody reads the gate as a role
  check it is not.
- **Sanctioning is deliberately not a one-click action.** The report queue
  dismisses, but issuing a sanction sends the moderator to the API, because a
  sanction needs a statement written for the account that receives it and a
  button that sent an empty one would be worse than no button.
- **Publishing a template supersedes inside a transaction.** The partial unique
  index allows one live version per key, so retiring the old version must
  happen before the insert or the index is briefly violated. Publishing only
  ever adds: a version a campaign already used is never edited.
- **Staff are told their own use is recorded.** The footer says every queue read
  and decision is audited against their account — which is true server-side, and
  the people relying on it should know.

Validation:

- admin 17 tests (16 new: `areas.test.ts` covers the role matrix, the landing
  area, and the unbuilt-area copy; `shell.test.tsx` was rewritten around the new
  shell); API 257 passed + the 4 PostGIS integration tests still skipped locally
  (5 new for template publishing and listing);
- workspace `typecheck`, `test` (40/40 turbo tasks on a forced full run),
  `build`, and `lint` (the 3 pre-existing `react-hooks/exhaustive-deps`
  warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

Six API tests timed out during this milestone, with the admin Vite build also in
flight, and passed on a serial run and on a forced full re-run. **Corrected
2026-09-05:** recorded at the time as a recurring flake needing a `testTimeout`
bump; it was self-inflicted contention from concurrent commands, and the config
is fine as it stands.

Unverified: the console has never been run against a live API — there is no
integration test that signs in and loads a queue, and the tests render markup
and exercise pure functions only. Nothing here has run against a real database.

### What Phase 3 still needs

- **Privacy, data-stewardship, and support routes**, before those three console
  areas are more than an honest placeholder. Support needs the privacy review
  first.
- **A sanction form in the console**, and a staff route to list or lift a
  sanction outside the appeal flow — today an early lift is a database change,
  the one moderation action with no audited path.
- **An email provider**, before any campaign sends anything.

## Phase 3 milestone 3.11 — sanction management, 2026-09-05

The gap 3.7 and 3.10 both left behind, and the one I flagged twice: issuing a
sanction from the console was impossible because it needs a written statement,
and **ending one early meant a database change nobody could review** — the only
moderation action with no audited path.

Two routes and a form close it. No migration: `sanctions.revoked_reason` has
been there since 026 waiting for something to write it.

### Decisions worth carrying forward

- **A lift needs a reason, and the reason is kept with the sanction.** An action
  that changes what somebody may do, with no record of why, is exactly what an
  audit exists to catch. The route refuses an empty one.
- **The reason is for the record, not for the account.** The notice says a
  decision was lifted and points at the settings screen; the internal note stays
  internal. The account is owed the outcome, not the staff shorthand.
- **The account is told in the same transaction**, so a sanction is never lifted
  with nobody told, and a lifted sanction is **revoked, never deleted** — the
  record of what was done and undone is the whole point.
- **An already-ended sanction answers `409`** rather than silently rewriting the
  reason it ended for. A sanction that expired on its own did not end because a
  moderator decided it should.
- **An open appeal is flagged in the history**, and the console warns against
  lifting under one: two staff answering the same question in different
  directions is how a decision stops being one. Deciding the appeal is the path
  that gives the account a single answer.
- **Reading somebody's history is audited** (`moderation.sanctions.read`),
  because looking at a person's moderation record is itself an act — and it is
  loaded on demand rather than with the queue, so it happens when a moderator
  asks rather than every time the page opens.
- **The history carries no reporter.** Who reported somebody is not part of
  deciding whether to lift, and the query does not join `reports` at all.
- **The console never offers to sanction a club.** The API refuses it — a club
  is moderated by acting on its owner or by archiving it — so the button is
  replaced by that sentence rather than by a request that would fail.
- **The sanction form describes each choice by what it does**, not by its name:
  a moderator choosing between them needs to know that a sharing pause leaves
  recording, history, and export untouched. That is the one thing in this
  feature it would be bad to get wrong.

Validation:

- API 268 passed + the 4 PostGIS integration tests still skipped locally (11 new
  in `moderation-routes.test.ts`); admin 23 (6 new in `areas.test.ts`);
- workspace `typecheck`, `test`, `build`, and `lint` (the 3 pre-existing
  `react-hooks/exhaustive-deps` warnings, 0 errors);
- Prettier verified per changed file, and `git diff --check` is clean.

The API suite failed one test again under the fully parallel turbo run and
passed serially, as it has all session. Unchanged recommendation, unchanged
reason for not acting on it unasked.

Unverified: as with 3.10, the console has never run against a live API, and
none of this has run against a real database.

### What Phase 3 still needs

- **Staff APIs for privacy requests, data stewardship, and support**, so those
  three console areas become more than an honest placeholder. Support needs a
  privacy review first — an account-lookup surface is the most sensitive thing
  in this product.
- **An email provider**, before any campaign sends anything.
- Everything else in the phase is built.

## Phase 3 milestone 3.12 — privacy and data-stewardship reads, 2026-09-05

Two of the three placeholder console areas become real, and a migration defect
that would have broken the first deploy was found and fixed.

`services/api/src/governance-routes.ts` serves two staff reads:
`GET /v1/staff/privacy/requests` and `GET /v1/staff/rules`. The console areas
that said "no staff route exists yet" now show them.

### The defect, first, because it matters more than the feature

`023_club_challenges.sql` seeds `rule_versions.kind = 'club_challenge'` and
`024_global_boards.sql` seeds `'global_board'`. Neither kind is in the CHECK
constraint `011` put on that column, so **both migrations would have failed on
first apply** — and every milestone since has been written against a schema
that could not exist. `023` now widens the constraint before its own seed,
covering both kinds, since it is the first migration that needs it.

This is precisely the class of bug the "never applied against PostGIS" caveat
has been hiding for ten milestones. There may be more; a real database run is
the only thing that will say.

### Decisions worth carrying forward

- **Both areas are read-only, and the console says why.** The worker performs
  erasure; a console button outside that path would be a second way to destroy
  data with none of the worker's ordering guarantees. Rules are published by
  migration; editing them here would change gameplay without a reviewed change
  behind it. Neither is a gap to fill later — they are the design.
- **The privacy queue is account ids, states, and timestamps.** No email
  address, no display name, no activity: a compliance queue is not a directory
  of who asked, and the test asserts the query never touches `profiles` or
  `email`.
- **Completed erasures are a count, never a list.** A list of who was erased
  would rebuild the very thing erasure removed.
- **`openForHours` is the number the screen is built around**, because the
  failure a privacy officer is watching for is the request that stopped moving.
  The 48-hour "needs a look" mark is a prompt for a human, not a legal deadline,
  and the console says so.
- **Both reads are audited.** Looking at a compliance queue is itself an act.

Validation:

- API 276 passed + the 4 PostGIS integration tests still skipped locally (8 new
  in `governance-routes.test.ts`); admin 26 (3 new; two existing tests were
  rewritten because the areas they described as unbuilt now exist);
- workspace `typecheck`, `test` (40/40 turbo tasks), `build`, and `lint` (the 3
  pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors) — no timeout
  failures on this run;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified: as before, nothing has run against a real database, and the console
has never been driven against a live API.

### What Phase 3 still needs

- **The support console area**, which is waiting on a privacy review rather
  than on implementation time: an account-lookup surface is the most sensitive
  thing in this product, and building it before that review would be deciding
  the question by writing code.
- **An email provider**, before any campaign sends anything.
- **A database run.** Migrations 018 through 027 have still never been applied;
  the defect found above is the first proof that the caveat has teeth.

## Migration verification, 2026-09-05

`pnpm verify:migrations` (`scripts/verify-migrations.mjs`) reads the migration
set in order and checks three things statically:

1. every literal seeded into a column with a `CHECK (col IN (...))` satisfies
   that constraint **as it stands at that point in the sequence**, widenings
   included;
2. every `INSERT INTO` targets a table that exists by then;
3. every `REFERENCES` points at one that does.

It exists because 3.12 found by eye that `023` and `024` seed rule kinds `011`
forbids — a defect that would have failed the first deploy and that no test in
the workspace could catch, since every suite runs against a fake database. The
check was validated by removing the fix and confirming it reports both
migrations, then restoring it.

It is deliberately narrow. Function bodies (`$$ ... $$`) are skipped, because
the inserts inside a trigger run against values it cannot see — reading them as
seeds produced a false alarm on `009` during development. A tuple whose items
do not line up with the column list is skipped for the same reason: an unsound
guess is worse than no check, because one false alarm teaches people to skip
the check entirely.

**It is not a substitute for applying the migrations.** It models `CHECK ... IN`
constraints and table existence, and nothing else — not column types, not
partial-index predicates, not the `period_end = period_start + length_days`
style of CHECK, not anything PostGIS does. Migrations 018 through 027 have still
never run against a real database.

Run it after any migration change:

```
pnpm verify:migrations
```

## Phase 4 milestone 4.1 — season enrollment and divisions, 2026-09-05

Phase 4 begins at the only place it can: everything territory needs _before_ it
can capture anything. **Territory capture is not built and remains disabled.**
ADR-0008 ends with "territory remains disabled until the Territory gate in the
release plan passes", and that gate — fair scoring, divisions, concentration,
anti-abuse review, and an MMR field study — has not been met.

`028_territory_seasons.sql` creates `territory_seasons` and
`territory_enrollments`, and deliberately **not** a contributions or
control-snapshot table: an empty table for a feature nobody has approved is an
invitation. Nothing in this milestone reads a location, and the route tests
assert the SQL never mentions a cell, an H3 index, a latitude, or a route.

### Decisions worth carrying forward

- **A division is assigned once, at enrollment, and never recomputed.**
  `product.md` permits rebalancing between seasons only, so re-joining reopens
  the existing row _without_ recomputing the band — leaving is not a way to
  reroll a division, and no amount of later activity moves anybody mid-season.
- **The band is stored and shown.** The enrollment carries the number of earlier
  active weeks it was read from, and the app says "you are in this group because
  you have been active in 9 earlier weeks". A cohort label somebody cannot
  question is worse than no label.
- **A season can be joined while it is running**, for the same reason a
  competition can be entered late: the alternative punishes somebody for hearing
  about it on Tuesday.
- **`live` is unreachable.** The status exists in the contract because the
  engine will need it, and the staff route deliberately cannot set it: reaching
  `live` would say the engine is running.
- **Division sizes are advice, never an action.** The staff read reports
  merge/split against `product.md`'s 100–250 target for the **next** season
  start. Moving somebody automatically mid-season is precisely the rebalancing
  that document forbids.
- **One place says capture is off.** `TERRITORY_CAPTURE_NOTE` in
  `@runsphere/domain` is read by the API and shown by the app in both the
  no-season and season states, because the word "season" promises a map and
  there is no map.
- **No rank is shown, because none is calculated.** `product.md` says a
  non-enrolled participant must not be shown a rank; there is nothing to show,
  and the render test asserts the season card displays no position, standing, or
  held-cell count.
- The division matcher is the one the global board already uses, widened to
  accept any rule carrying bands. Both answer "how long has this account been
  active", and answering it twice would eventually mean answering it
  differently.

Validation:

- domain 175 (13 new in `territory.test.ts`); API 296 passed + the 4 PostGIS
  integration tests still skipped locally (20 new in `territory-routes.test.ts`);
  mobile 471 (7 new);
- workspace `typecheck`, `test`, `build`, `lint`, and `verify:migrations`;
- Prettier verified per changed file, and `git diff --check` is clean.

Two things this milestone corrected in itself, worth recording because both were
my errors rather than the plan's: a `territoryVisibleToMembers` predicate that
ignored its argument and decided nothing (deleted rather than silenced), and a
render assertion that forbade the word "rank" in the season card — where the
copy _should_ say "no rank is calculated". The assertion now forbids a displayed
rank, which is the actual rule.

The API suite failed one test again under the fully parallel turbo run and
passed serially. Unchanged recommendation, unchanged reason for not acting on it
unasked.

### What Phase 4 still needs, and what it must not have yet

Everything else in Phase 4 is behind the Territory gate: the H3 traversal
engine, cell contributions, weekly control snapshots, the season ladder, the map
surface, and the concentration guardrails. **None of it should be built until
the gate opens**, and 4.1 stopped exactly at that line rather than building an
engine that could not be switched on.

The honest next steps outside territory are unchanged: the support console area
(waiting on a privacy review), an email provider, and a database run.

## Phase 4 milestone 4.2 — the traversal and control engine, 2026-09-05

The arithmetic of a territory season, written out and switched off.

`packages/domain/src/territory-scoring.ts` implements ADR-0008 as pure
functions; `029_territory_contributions.sql` adds the tables that would hold
its output and publishes territory rule v2 with the scoring parameters `028`
deliberately left out; `services/worker/src/territory-scoring.ts` is the job
that would drive it and currently refuses to.

### Why it is written before it can run

The rules are the reviewable part. Whether a cell is scored once or per visit,
whether a tie goes to the earliest start, whether the daily cap applies before
or after the window is chosen — these are the decisions the Territory gate is
meant to examine, and they are far easier to examine as nineteen named tests
than as prose. The engine can be read, argued with, and corrected before a
single participant is affected by it.

### The three refusals

Nothing scores until all three are false:

1. **`capture_disabled`** — `TERRITORY_CAPTURE_ENABLED` is false until the
   Territory gate passes.
2. **`no_indexer`** — no H3 library is a dependency of this workspace. ADR-0001
   requires the library and algorithm versions pinned on every contribution, so
   the indexer is injected and carries its own version rather than the engine
   assuming one. Adding the dependency is a decision, not a detail.
3. **`no_eligibility_source`** — **there is no public-space eligibility
   dataset.** This is the one that matters most. Scoring every traversed cell
   instead would record where people live and work, which is precisely what
   public-space eligibility exists to prevent. Its absence stops the job rather
   than widening it, and there is a test whose only purpose is to hold that
   line.

Each refusal happens before the first query, because a scoring job that quietly
does nothing looks exactly like one that is broken.

### Decisions worth carrying forward

- **A cell counts once, however long you are in it.** Standing still for an
  hour scores one cell; sprinting through scores what you passed. That single
  choice is what makes the measure pace-neutral, and it has a test that states
  it in one assertion.
- **The window is a span of wall-clock time, not a pick of favourable points.**
  Three cells spread over ninety minutes cannot all be claimed.
- **Control counts distinct days, not visits.** Passing through a cell three
  times in one afternoon loses to somebody who came on two days.
- **Input order never decides control.** The resolver is fed the final accepted
  set and compares only day counts, accepted instants, and — as a documented
  reproducibility fallback, not a fair tiebreak — the opaque reference. A test
  reverses the input and asserts the same answer.
- **Snapshots are versioned, never updated.** A recomputation writes version
  N+1 and leaves N in place, so a correction is auditable and a participant can
  be shown what changed rather than finding their week silently rewritten.
- **The opaque participant reference never leaves the worker.** The snapshot
  stores it; no route returns it, and no map may name a holder.

### Two facts found while building

- **Timestamped points live only in `activity_chunks`**, which are purged on the
  raw-trace retention clock. `activity_derivations.shareable_route` is a
  geometry with no time dimension, and the best-contiguous-window rule needs
  times. So territory scoring must run _inside_ the retention window, and a
  season cannot be scored retroactively once traces are purged. That is the
  right privacy outcome — the trace goes, the cells remain — but it is a
  scheduling constraint nobody has written down before.
- **The ladder formula is an interpretation.** ADR-0008 says the ladder uses
  "capped control-days" without saying over what period, or per cell versus per
  participant. This reads it as per participant per week, which is the reading
  that makes the cap do the job the ADR gives it. The code and the migration
  both say so. **Confirm before a season runs for real.**

Validation:

- domain 194 (19 new in `territory-scoring.test.ts`); worker 102 (4 new). The
  worker tests assert the refusals, so they will be the first tests to fail when
  the gate opens — which is what they are for;
- workspace `typecheck`, `test`, `build`, `lint`, and `verify:migrations`;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified, and worth being blunt about: **no part of this engine has ever
processed a real trace.** The indexer in the tests is a fake that reads a cell
off the latitude. The behaviour under real H3 indexing, real GPS noise, and a
real eligibility dataset is unknown, and the MMR field study in the release plan
is what would answer it.

### Correction: the "parallel-run flake" was not a flake

Four earlier milestones in this file recorded a recurring API test timeout as
unexplained machine contention and proposed raising `testTimeout`. That
diagnosis was wrong in its remedy, and those notes are now annotated.

What actually happened: full `turbo run typecheck test build lint` runs were
launched in the background and then Prettier, ESLint, and a second vitest were
run against the same machine while they were in flight. The worst case reported
**130 failed API tests**; the tell was a single-file Prettier run taking 36
seconds. Run alone immediately afterwards, the API suite passed 296 with 4
skipped, and a full clean workspace run passed 40/40 turbo tasks — domain 194,
mobile 471, API 296 (+4 skipped), worker 102, admin 26.

**Rule for whoever picks this up:** run the full verification with nothing else
competing, and treat a timeout as a real signal rather than raising the limit. A
`testTimeout` bump would have hidden a scheduling mistake and blunted the one
warning that would catch a genuine slowness regression.

### What Phase 4 still needs

- **An H3 dependency** with a pinned version, and a binding that satisfies
  `CellIndexer`.
- **A public-space eligibility dataset**, its source, licence, and import
  pipeline. This is a project, not a task, and the cost and licensing questions
  belong with ADR-0010's approval bands.
- **The Territory gate**: fair scoring, division, concentration, and anti-abuse
  review, plus the MMR field study.
- The map surface, the season ladder read paths, and the concentration
  guardrails — all of which want a working engine underneath them first.

## Phase 4 milestones 4.3–4.6 — the rest of a season, 2026-09-06

Everything a territory season needs after scoring: closing a week, the ladder,
the map, the concentration guardrails, and rollback. **None of it runs.**
`TERRITORY_CAPTURE_ENABLED` is still false, no H3 library is a dependency of
either the server or the app, and there is still no public-space eligibility
dataset. What exists is the whole shape of a season, reviewable in one piece at
the Territory gate instead of half of it.

### The rules that came out of building it

- **A week is snapshotted only after it has ended.** ADR-0006 makes a weekly
  period immutable once written, so a snapshot of a week still running would
  make version 1 of every week wrong by construction. `snapshotTerritoryWeek`
  refuses with `week_not_closed`.
- **The weekly reset is structural, not a job.** Control is stored per week, so
  a new week has no control rows until its own contributions resolve. Nothing
  deletes last week's control: history is kept, and what resets is what the
  current week shows.
- **A finalized week is never re-snapshotted by a sweep.** A second automatic
  pass would write version N+1 of an unchanged week and turn the version history
  into a record of how often the worker ran. Recomputation is a deliberate act.
- **One pointer, and it is the only thing rollback moves.**
  `territory_week_state.current_version` says which snapshot a week shows. No
  snapshot is ever edited or deleted, and rolling _forward_ is deliberately
  impossible — that is a recomputation, a different act with a different record.
- **The season ladder is a full recompute from each week's current version.**
  That is what makes a rollback reach the ladder at all, with no separate
  correction step for somebody to forget.
- **Withdrawing removes a standing rather than freezing it.** The season is
  opt-in, and leaving should take somebody off the board rather than leaving
  their number on one they quit.

### The decision most worth arguing with

**The territory ladder carries no identities at all.** Not names, not handles,
not account ids — a row is a rank and a number of points, and the only one a
reader can attach to a person is their own.

The reasoning: the global board publishes display names because its score is
capped active minutes, which is how long somebody moved. A territory standing is
derived from _where somebody physically went in public space_. Putting a name
beside that, on a screen that also shows a map of held ground, hands back
precisely what ADR-0008 makes the map withhold.

The cost is real and should be weighed rather than assumed away: this ladder
offers no social comparison against named people, which is a large part of what
makes a ladder motivating. The response says so in its own words
(`TERRITORY_LADDER_NOTE`), so somebody expecting names is told why there are
none instead of assuming the screen is broken. **If the gate wants names, that
is a decision to make explicitly, not to discover in an implementation.**

### Two things found while building

- **Below 13 participants the 8% top-participant guardrail is arithmetically
  unreachable.** The smallest possible share is `1/n`, so twelve people
  splitting points perfectly evenly already sit above 8%. Unhandled, this would
  have reported a breach every single day of any small pilot and buried the real
  ones. `concentrationApplies` reports it as not-applicable, and the console says
  what it actually means: merge the division at the next season start.
- **A ladder or map failure was taking the season card down with it.** The first
  wiring of the Play tab put all three reads in one promise chain, so a failing
  panel flipped `territoryRemoteState` to `error` and removed the join and leave
  buttons — the working half of the screen going down with the broken half. They
  now fail independently.

### What the map does, and what it cannot

`GET /v1/territory/seasons/:seasonId/map` returns an H3 index and one bit per
cell: whether the reader holds it. No holder, no time, no count, no route.
Only the reader's own division, because a map spanning all of them would let
anybody read a city's activity off a screen meant to show their own game.

**It cannot be drawn.** Turning an index into a boundary is H3's job and the app
has no H3 binding, so `territoryMapPlan` takes an injected `CellBoundarySource`
and without one returns `no-boundaries` — with a sentence saying the areas are
still counted. A resolution mismatch is treated identically: a cell one
resolution out is about seven times the area, which would put a claim on ground
nobody covered.

The empty states are the part that actually exists, and they are three separate
sentences on purpose — not joined, nothing held yet, cannot be drawn — because a
blank map reads as an unclaimed city.

### The field study

[`docs/territory-field-study.md`](territory-field-study.md) is new: cell
inventory, route repeatability under GPS noise, pace neutrality across speeds, a
concentration simulation, and device cost, with thresholds and exit criteria
fixed **before** anybody is under pressure to pass them. It is written and **has
not been run** — it is the one Phase 4 deliverable that cannot be produced from a
keyboard, and it cannot even start until the eligibility dataset exists.

Validation:

- domain 216 (22 new in `territory-season.test.ts`); worker 106 (4 new); API 316
  passed + the 4 PostGIS integration tests still skipped (20 new in
  `territory-season-routes.test.ts`); mobile 484 (11 new in
  `territory-model.test.ts`, 3 new in `PlayScreen.render.test.tsx`); admin 30
  (4 new);
- workspace `typecheck`, `test`, `build`, `lint`, and `verify:migrations`;
- Prettier verified per changed file, and `git diff --check` is clean.

Unverified, and worth being blunt about: **not one line of this has processed a
real trace or run against a real database.** The indexer in the tests reads a
cell off a latitude, the boundary source is a square, and every query is checked
against a fake. `030_territory_week_state.sql` has never run against a real
PostGIS: watch the `to_version < from_version` CHECK on
`territory_week_rollbacks` and the `numeric(6,5)` share columns on first apply.

### What is left, and none of it is code

1. **An H3 dependency** with a pinned version — a `CellIndexer` on the server
   and a `CellBoundarySource` in the app.
2. **A public-space eligibility dataset**: source, licence, import pipeline. A
   project, not a task, and its cost and licensing belong with ADR-0010's
   approval bands. The field study cannot start without it.
3. **The Territory gate**: fair scoring, division, concentration, and anti-abuse
   review — plus the field study above.

Until those three, everything in Phase 4 stays exactly as it is: written,
tested, refusing, and honest about why.
