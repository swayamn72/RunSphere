# TURFR mobile handoff

TURFR is the public app name. RunSphere remains the repository and internal
project name. Preserve Android package `com.runsphere.app`, the Expo identity,
and the existing `runsphere://` links so installs and invites continue to work.
The [Play submission guide](../play-store-submission.md) covers launch assets and copy.

## Approved design

- The [approved Home color reference](../assets/homepage-reference3.png) sets
  the near-black, lime and warm off-white palette. Its old wordmark and labels
  are visual reference only. Shared colors live in
  [packages/ui](../../packages/ui/src/index.ts). Map-specific colors live in
  [game-world.ts](../../apps/mobile/src/theme/game-world.ts).
- Home reads Turf, Start a run, This week, Quests. The Turf illustration is
  decorative. Turf points are derived from server-reported held area at
  one point per 100 square metres, rounded down, with a less-than-one display
  for positive holdings below the threshold. Ranking uses exact area.
- Weekly activity pips show a count. The API does not supply per-day activity
  for this meter. Quest rows open details and use a bundled Carter Road-inspired
  illustration. The app has no quest image upload feature.
- Home has no level or Find a loop card. Route browsing is in the run picker.
  A claim-ready run can still open from Home. The Map HUD can show progression.
- Map and live-run screens keep dark surfaces. Lime identifies primary actions,
  your Turf and active tabs. Preserve the distinct warning, rival and quest
  accents. Home metrics and quest rows, Social standings and Profile stats use
  warm off-white cards with dark text.
- First-launch modes are Free run, Turf and Quest. Ghost Race entry points are
  deferred. Keep existing race history, API behavior and privacy opt-out intact.
  The separate H3 cell-season engine remains gated.

## Preview and validation

Use the Android dev client and Metro. Set `EXPO_PUBLIC_HOME_PREVIEW=true` in the
local mobile environment for labeled sample Home and Turf data in development.
Use an existing signed-in test session. Validate real account and quest states
with preview mode disabled. Windows runs can use `adb reverse tcp:8081 tcp:8081`
after starting Metro and opening its dev-client URL. IPv4 loopback must reach the
Metro listener. Keep local environment files, screenshots and APKs out of git.

The palette was checked on a Pixel 9a emulator across Home, Map, the Run picker,
Social and Profile with sample data. Typecheck and 980 mobile Vitest tests passed
during the palette iteration. Android splash and launcher colors are native
resources and require a new native build to see on device. The committed native
project is hand-edited. See [Android development](../../apps/mobile/DEVELOPMENT.md)
before regenerating it.

Still to verify on a physical Android device before release:

- In-place upgrade with a queued run and an existing invite.
- App label, launcher masks and splash with a fresh native build.
- Home and the run journey with large text and TalkBack, plus an outdoor GPS run.
- Real quest, offline and claim-ready states, and production notification,
  email, policy and account deletion journeys using the public branding.

Use the [roadmap](../../IMPLEMENTATION_ROADMAP.md), [status](../../IMPLEMENTATION_STATUS.md)
and [risks](../../BUGS_AND_RISKS.md) for remaining work and release blockers.
