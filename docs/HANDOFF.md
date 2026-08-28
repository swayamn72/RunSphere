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
