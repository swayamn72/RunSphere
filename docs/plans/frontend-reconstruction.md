# Frontend reconstruction: audit, design-system plan, checklist

Status: **Phase 1 (audit) and Phase 2 (architecture) done 2026-11-25. Decisions are in
[ADR-0016](../adr/0016-design-system-light-default.md). Phase 3 (foundation) in progress: step 1 done.** No application
source has changed yet. Baseline: commit `6e73766`
(branch `feat/ios-app`).

This file is the persistent progress report for the frontend reconstruction. Update the
checklists in §8 as work lands, in the same commit as the work.

## 1. Product, as built

TURFR (public name; RunSphere internally) is a running-only, Android-first game for Mumbai.
You record a run offline in an encrypted SQLite queue. The run uploads in checksummed chunks,
and the server validates it, trims the private start and finish, and derives the activity.
A closed loop claims **Turf**: real ground on the map that rivals can take back. Around that
loop sit quests (verified checkpoints with a time limit), weekly progression and XP,
achievements, friends, clubs, challenges and competitions, notifications, and privacy controls
(200 m zones, visibility, safety shares, export and deletion). The server is authoritative for
every reward. Pace is never judged (ADR-0005).

- **Runners** use the Expo app: five tabs `Home, Map, Run, Social, Profile`, landing on Home.
- **Staff** use the Vite admin console: ten role-gated areas, every read audited.

## 2. Frontend architecture, as built

| Concern    | Mobile (`apps/mobile`)                                                                                                                          | Admin (`apps/admin`)                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Styling    | `StyleSheet` via `useAppStyles()` (`components/styles.ts`, 1,208 lines) + 15 local sheets                                                       | One global `styles.css` (172 lines), element selectors  |
| Tokens     | `@runsphere/ui` `darkTokens`, `radius`; Turf palette in `theme/game-world.ts`                                                                   | None. 14 hard-coded hexes, unrelated dark-green palette |
| Theme      | `ThemeProvider`; **dark-only by decision**, enforced by `theme.test.ts`, `app.config.ts` `userInterfaceStyle: 'dark'` and Android `strings.xml` | Light paper only                                        |
| Fonts      | Platform system font; no `fontFamily` set                                                                                                       | `Inter` declared but never loaded, so it falls back     |
| Navigation | Hand-rolled tab and route state in `App.tsx` (779 lines); no navigation library                                                                 | `useState` area switch; no router, no URL state         |
| Data       | `MobileApiClient` (single-flight refresh), local state; no query library                                                                        | `api.ts` fetch helpers, in-memory session + refresh     |
| Icons      | `NavigationIcon` (react-native-svg) for tabs; Unicode glyphs elsewhere (`‹ → ›`)                                                                | None                                                    |
| Animation  | `react-native-reanimated` 4, `expo-blur`                                                                                                        | None                                                    |
| Maps       | MapLibre RN 11.3.7, dark Turf world style                                                                                                       | None                                                    |
| Tests      | Vitest + react-test-renderer; 114 files / 990 tests                                                                                             | Vitest + `renderToStaticMarkup`; 5 files / 40 tests     |
| Guards     | No hex outside `theme/`; AA contrast matrix; voice-copy banned words; `failureMessage`                                                          | None                                                    |

Shadcn/Tailwind: not present, and **not recommended**. The admin has 10 areas and plain CSS.
Tailwind + Radix would be a new styling stack for little gain. CSS custom properties generated
from `@runsphere/ui` give the same theming with zero runtime dependencies. The `shadcn` and
`ui-styling` skills do not fit this repo. `ui-ux-pro-max` and `design-system` are useful as
reference only.

## 3. Brand and the approved design (the binding constraint)

`docs/plans/turfr-ui-rebrand.md` records an **approved** TURFR design: near-black chrome,
lime `#C9F44A` for primary actions, your Turf and active tabs, and warm off-white paper
`#F4F2ED` cards with dark ink for Home metrics, Social standings and Profile stats. The Map
and the live run stay dark. Launcher icon, splash and Play assets already use it.
The reference is `docs/assets/homepage-reference3.png`.

The reconstruction brief proposed light-by-default with an orange accent. The owner chose light by
default. The accent stays lime on contrast and differentiation grounds (ADR-0016).

## 4. Inventories

### Admin areas (`apps/admin/src/areas.ts`)

| Area                      | Gate                          | Backed by                                    | Writes                                     |
| ------------------------- | ----------------------------- | -------------------------------------------- | ------------------------------------------ |
| Sign-in                   | none                          | `/v1/auth/login`, `/v1/auth/refresh`         | session                                    |
| Activity review           | any staff (server allow-list) | `/v1/staff/activity-review-queue`            | none                                       |
| Moderation                | `canModerate`                 | reports, appeals, sanctions                  | resolve, sanction, lift, decide appeal     |
| Competitions              | `canOperateCompetitions`      | `/v1/competitions`, `/v1/staff/competitions` | create, set status                         |
| Turf claims (`turf-area`) | moderator or season operator  | trade flags, concentration                   | flag review                                |
| Quests (`quests-area`)    | `canOperateCompetitions`      | `/v1/staff/quests`                           | set time limit                             |
| Territory seasons         | `canOperateCompetitions`      | seasons, divisions, concentration, weeks     | week rollback                              |
| Campaign email            | `canManageCampaigns`          | campaigns, email templates                   | publish template, create, schedule, cancel |
| Privacy requests          | privacy_officer               | `/v1/staff/privacy/requests`                 | none (read-only by design)                 |
| Data stewardship          | data_steward                  | `/v1/staff/rules`                            | none (read-only by design)                 |
| Support                   | support                       | **unbuilt**, shows `unbuiltReason`           | none                                       |

### Mobile screens (`apps/mobile/src/screens`, by area)

- **Onboarding:** `OnboardingScreen`, `OnboardingSocialStep`, `AccountRecoveryScreen`; tour overlays `TutorialOverlay`, `TourRho`, `LoopCallout`.
- **Home:** `HomeScreen`, `HomeDashboard`, `QuestProgressCard`, `RunsSharingPrompt`.
- **Map / Turf:** `TurfScreen` (1,620 lines), `TerritoryPanel`, `TerritoryDetailScreen`, `QuestDetailScreen`, `QuestStopMarkers`, `ExploreScreen`, `maps/*`.
- **Run:** `PlayScreen` (1,487), `RunModePicker`, `RoutePreviewScreen`, `GhostRaceSheet`, `ActivityScreens` (preparation, recording, detail, history; 1,455).
- **Social:** `FriendsScreen`, `ClubsScreen` (990), `RunnerSearch`, `RunnerProfileSheet`, `SharedWithYou`, `InviteAcceptSheet`, `NotificationsScreen`.
- **Profile:** `ProductScreens` → `ProfileScreen`, `ProfileOverview`, `ProfileIdentityScreen`, `PrivacySettingsScreen`, `PrivacyZoneList`, `AchievementsScreen`, `SeasonHistory`, `RunLogSection`, `RunDetailHost`/`RunDetailScreen`/`RunDetailMap`, `RunCharts`.

## 5. Inconsistency findings

**Mobile**

- 28 distinct font sizes (9 to 112). 95 uses of weight `900` and 45 of `800`, so nearly every label shouts and hierarchy flattens.
- `space` tokens exist but are used **zero** times; 397 literal padding, margin and gap values.
- 10 distinct literal `borderRadius` values next to 4 tokens (31 token uses).
- Tabular numerals are used once (`splitValue`). Stats, timers and pace jitter as digits change.
- `status.success` is the brand lime, so "success" and "primary action" can't be told apart. `eyebrow` labels are coloured with `status.success`.
- `text.tertiary` is identical to `text.secondary`, so it adds no step.
- Back, forward and disclosure affordances are Unicode glyphs (`‹ → ›`) beside SVG tab icons.
- `styles.ts` mixes base primitives with screen-specific rules; three screens over 1,400 lines carry their own sheets.

**Admin**

- Its palette (dark green `#184f3d`, teal `#168d77`, `#c9f15a`) is not TURFR's and not from `@runsphere/ui`.
- `nav`, `.row` and `[aria-current]` have no styles: the active area isn't visible and the navigation is a run of default-styled buttons.
- No focus-visible styles. `button:disabled` uses `cursor: wait` for every disabled state.
- `shell.tsx` is one 1,240-line component with 19 `useState`s holding every area's data.
- No URL state: a refresh drops the open area, and there are no deep links.
- `Inter` is named in CSS but never loaded.
- `NO_ROLES_MESSAGE` is unreachable: Activity review is open to any signed-in account (`ANY_STAFF` in `areas.ts`, gated by the server), so a no-role account sees that one area instead of the message. Found by the Playwright sign-in spec. Left as is: it's an access decision for the owner, not a styling one.

## 6. Functionality that must survive (preservation checklist)

Every item here is checked again before each screen or area is marked done.

- [ ] Auth: login, single-flight refresh, sign-out, `clearStaffSession`, the mobile logout coordinator.
- [ ] Every API call in `apps/admin/src/api.ts` and `apps/mobile/src/api-client.ts`, with unchanged method, path and payload.
- [ ] Role gating through `areas.ts` predicates; `initialArea`; `NO_ROLES_MESSAGE`; audit notice; unbuilt-area honesty.
- [ ] Moderation sanction flow, including the open-appeal warning and lift reason.
- [ ] Season rollback reason, the concentration not-applicable note, privacy and rules read-only notes.
- [ ] Mobile tabs and the landing tab defined only in `navigation/types.ts`.
- [ ] Recording: permissions, background location task, SQLCipher queue, chunked sync, synthetic GPS.
- [ ] MapLibre layers, Turf world style, `game-world.ts` palette, held-ground redraw after style load.
- [ ] Claims, the claim-ready flow from Home, quests, Ghost Race history and the privacy opt-out.
- [ ] Notifications and push registration, invite links (`runsphere://`), account deletion (ADR-0012).
- [ ] Tutorial tour targets (`tutorial-targets.ts`) still resolve after layout changes.
- [ ] Guards stay on: no-hex test, AA matrix, `voice-copy.test.ts`, `failureMessage` rule, Android permission check.

## 7. Baseline (2026-11-25, macOS, commit `6e73766` + local `.gitignore` edit)

| Check                               | Result                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| `pnpm typecheck`                    | pass                                                              |
| `pnpm lint`                         | pass, 0 errors                                                    |
| `@runsphere/mobile` `vitest run`    | 114 files, 990 tests, pass                                        |
| `@runsphere/admin`, `@runsphere/ui` | 5 files, 40 tests, pass                                           |
| `@runsphere/admin` build            | pass (383 kB JS, 2 kB CSS)                                        |
| PostGIS integration, API, worker    | not run (no DB change planned)                                    |
| Playwright                          | not installed                                                     |
| Screenshots                         | none captured yet (no simulator or browser session in this audit) |

## 8. Design-system architecture (decided, ADR-0016)

**Principle: extend `@runsphere/ui`, don't restructure it.** Every current export (`darkTokens`,
`appPalette`, `semanticTokens`, `ownerPalette`, `contrastPairs`, `radius`, `space`) keeps its
name. Values may change where this section says so. **The AA matrix test is the authority:** if
a value below fails a pair, adjust it minimally and record the change here.

### 8.1 Semantic roles (`packages/ui`)

Add to `SemanticTokens`. All additions are optional for consumers, and both token sets fill them.

| New role                            | Light                | Dark                 | Why                                                                                                     |
| ----------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `text.accent`                       | `#3F5A00` olive      | `#C9F44A` lime       | Links, eyebrows, selected labels. Lime can't be text on light.                                          |
| `text.onSelected`                   | `#141414`            | `#101010`            | Ink on a lime fill (`action.selected`).                                                                 |
| `text.onPaper`, `text.onPaperMuted` | `#141414`, `#4A4843` | `#101010`, `#474541` | The approved paper cards. Replaces raw `appPalette.ink`/`mutedInk` (71 `appPalette.*` uses in 6 files). |
| `background.paper`                  | `#FFFFFF`            | `#F4F2ED`            | Keeps dark mode's approved paper cards; in light they're the plain surface.                             |
| `border.paper`                      | `#E2DED6`            | `#D5D2CB`            | Lines inside paper cards.                                                                               |
| `brand.lime`                        | `#C9F44A`            | `#C9F44A`            | The fill for yours/selected/progress. Never text on light.                                              |

`lightTokens` (new):

| Group                                | Values                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| background                           | canvas `#F4F2ED`, surface `#FFFFFF`, surfaceRaised `#FFFFFF` (with elevation 1), surfaceInset `#EFECE6`                                             |
| text                                 | primary `#141414`, secondary `#4A4843`, tertiary `#5F5C56`, disabled `#9C9891`, inverse `#F4F2ED`, onAccent `#F4F2ED`, danger `#B4233C`             |
| border                               | subtle `#E2DED6`, strong `#86827A`, focus `#3F5A00`                                                                                                 |
| action                               | primary `#141414`, primaryPressed `#2B2B2B`, secondary `#FFFFFF`, selected `#C9F44A`, disabled `#E2DED6`, danger `#B4233C`, dangerPressed `#951C31` |
| status                               | info `#0B6E99`, success `#1A6E44`, warning `#9A5B00`, error `#B4233C`, pending `#9A5B00`                                                            |
| accent                               | violet `#6D4BD8`, amber `#9A5B00`, coral `#B4233C`, azure `#0B6E99`, gold `#8A6400`                                                                 |
| scrim                                | subtle `#14141433`, strong `#141414B3`                                                                                                              |
| zone, route, checkpoint, map, mascot | **identical to dark**: they're drawn on the always-dark map                                                                                         |

Changes to `darkTokens`:

- `status.success` separates from lime. Start at `#5BD08F` and check it.
- `text.tertiary` gets its own step, darker than secondary but still AA. Start at `#9E9A93`.

Contrast pairs:

- Move the AA matrix from `apps/mobile/src/theme/theme.test.ts` into `packages/ui/src/index.test.ts` and run it over **both** token sets.
- `contrastPairs.raceGhost` must use an ink role, not `text.onAccent`. Paper on rose is 3.28:1. The ghost chip is map-only, so it reads dark tokens in both themes.

Measured (light):

| Pair                          | Ratio            |
| ----------------------------- | ---------------- |
| ink on canvas                 | 16.5             |
| secondary on canvas           | 8.2              |
| tertiary on inset             | 5.45             |
| olive on canvas               | 7.0              |
| danger on canvas              | 5.8              |
| ink on lime                   | 14.5             |
| paper on ink                  | 16.5             |
| `border.strong` (3:1 graphic) | 3.0+ (`#86827A`) |

### 8.2 Typography (Inter; both apps)

`typeScale` in `packages/ui`: size/lineHeight in dp or px, weight, letterSpacing. Numeric roles
set `tabular: true`.

| Role         | Size / line | Weight | Tracking | Use                                             |
| ------------ | ----------- | ------ | -------- | ----------------------------------------------- |
| `liveMetric` | 56 / 60     | 700    | -1.0     | Live-run HUD primary number (tabular)           |
| `display`    | 40 / 44     | 700    | -0.8     | Hero number: Turf points, run summary (tabular) |
| `title`      | 28 / 34     | 700    | -0.4     | Screen title                                    |
| `metric`     | 24 / 28     | 600    | -0.3     | Stat values (tabular)                           |
| `heading`    | 20 / 26     | 600    | -0.2     | Section heading                                 |
| `subheading` | 17 / 22     | 600    | 0        | Card and row title                              |
| `body`       | 15 / 22     | 400    | 0        | Running text                                    |
| `bodyStrong` | 15 / 22     | 600    | 0        | Emphasis in body                                |
| `label`      | 13 / 18     | 500    | 0.1      | Buttons (secondary), form labels, chips         |
| `caption`    | 12 / 16     | 400    | 0.1      | Supporting detail, timestamps                   |
| `overline`   | 11 / 14     | 600    | 0.8      | Sparse eyebrows only, uppercase                 |

The admin uses the same roles. It can step `title` up to 32 and `display` to 44 at ≥1024px.

`fontWeight = { regular: '400', medium: '500', semibold: '600', bold: '700' }`. No 800/900.

- **Mobile:** load `Inter-Regular`, `Inter-Medium`, `Inter-SemiBold` and `Inter-Bold` (static TTF,
  OFL, with `LICENSE.txt` beside them in `apps/mobile/assets/fonts/`) through `expo-font`
  `loadAsync` during the existing boot phase. **On Android, `fontWeight` does not pick a custom
  file**, so `AppText` maps weight to family name. Fall back to the system font on load failure.
  Tabular figures use `fontVariant: ['tabular-nums']`.
- **Admin:** `@fontsource-variable/inter`, imported in `main.tsx` (self-hosted by Vite, no CDN
  request). Use `font-variant-numeric: tabular-nums` for numeric roles and table number columns.

### 8.3 Space, radius, elevation, motion, layout

- `space`: keep `xs 4, sm 8, md 12, lg 16, xl 20, xxl 28`. Add `xxs 2`, `xxxl 40`. The screen
  gutter is `lg` (16; it was 18).
- `radius`: retune existing keys to `card 16, control 12, chip 8, pill 999`. Add `sm 6` and
  `sheet 24`. That's a deliberate change: fewer over-rounded containers.
- `elevation` (light only; dark uses surface steps):
  - `e1`: cards, `0 1 2` at 6% ink, Android elevation 1.
  - `e2`: menus and popovers, `0 4 12` at 10%, elevation 4.
  - `e3`: sheets and dialogs, `0 12 32` at 16%, elevation 12.
  - `shadowColor` is a token.
- `motion`: `fast 120, base 200, slow 320` ms. Honour `reduceMotion`, which `ThemeProvider` already exposes.
- Web layout:
  - breakpoints `sm 640, md 768, lg 1024, xl 1280`;
  - content max width 1200; sidebar 240 at ≥1024;
  - top bar with a menu button below 1024; 16px gutter on phones.

### 8.4 Web bridge (admin)

- `toCssVariables(tokens): Record<string, string>` in `packages/ui` is pure and unit-tested. It
  emits `--rs-bg-canvas`, `--rs-text-primary` and so on, plus type, space and radius variables.
- The admin builds a `<style>` with `:root[data-theme="light"]{…}` and `:root[data-theme="dark"]{…}`
  from it at startup. `styles.css` then uses only `var(--rs-*)`, with no hex literals. Add a test
  like mobile's no-hex guard for `apps/admin/src`.
- An inline script in `index.html`, before the bundle, reads `localStorage['rs-theme']`
  (`light|dark|system`, default `light`). It sets `data-theme` and `<meta name="theme-color">`
  before first paint, so the wrong theme never flashes.

### 8.5 Admin structure

- **Shell:** sidebar (≥1024) or top bar with a drawer (<1024). It has the TURFR Operations
  wordmark, the areas list with a visible current item (`aria-current`), and a session block
  (roles, sign out). Keep the audit notice visible, and add the theme menu.
- **Areas:** split `shell.tsx` into one `*-area.tsx` per area, following `turf-area.tsx` and
  `quests-area.tsx`. Each area owns its state and loads on open; the shell keeps only session,
  roles and the current area. Every `api.ts` call keeps its arguments. **Move, don't rewrite,
  the handlers.**
- **URL state:** sync the open area to `?area=` with `history.replaceState`/`pushState`, so a
  refresh keeps your place. No API change. Gating still goes through `permittedAreas`.
- **Primitives** in `apps/admin/src/ui/`: `PageHeader`, `Section`, `DataTable` (sticky header,
  numeric right-aligned and tabular, empty row), `StatusTag` (tone: neutral, info, success,
  warning, danger), `Button` (primary, secondary, ghost, danger; a real disabled state, not
  `cursor: wait`), `Field`, `Notice` (info, warning, read-only), `EmptyState`, `Dialog` (native
  `<dialog>`). Add focus-visible rings everywhere.
- **Area layouts** (one generic template is not allowed):
  - Review, privacy requests and rules: dense tables with filters.
  - Moderation: a queue list with a detail panel (split view).
  - Competitions and campaigns: list plus a create form in a side panel.
  - Seasons: season picker, then division table, concentration table and week timeline.
  - Turf: concentration summary, then a flags table.
  - Quests: an editable table.
- **Playwright** (`apps/admin/e2e`, `@playwright/test`, script `test:e2e`, not in `pnpm test`/CI):
  - mock `/v1/*` with `page.route`;
  - cover sign-in, role-gated navigation, each area's main form, and the theme switch with
    persistence;
  - take screenshots at 375, 768 and 1280 in light and dark.

### 8.6 Mobile structure

- **Theme state:**
  - `AppColorScheme = 'light' | 'dark'` and `ThemePreference = 'light' | 'dark' | 'system'`,
    default `light`.
  - Persist with `expo-secure-store` in a `theme-preference.native.ts`, plus a plain stub for
    tests. Register it in `metro.config.js` `FORCE_PLAIN_TS` if imported by bare name.
  - Read it during boot, before the first themed frame.
  - Call `Appearance.setColorScheme(resolved)` so native pickers and the keyboard match.
- **Native config:** `userInterfaceStyle: 'automatic'` in `app.config.ts`. Edit Android
  `values/strings.xml` and iOS `Info.plist` by hand; **no prebuild**. The splash stays near-black.
- **Always-dark islands:** a `ForceTheme scheme="dark"` provider wraps the Map/Turf tab, the live
  recording screen and map sheets. Their status bar is light-content; elsewhere it follows the theme.
- **Appearance setting:** Profile → settings gets "Appearance: Light / Dark / Match phone". Copy
  must pass `voice-copy.test.ts`.
- **`AppText`** (`components/AppText.tsx`): `variant` from `typeScale`, `tone` from text roles,
  and `tabular` for numbers. Screens stop setting `fontSize`/`fontWeight` directly. Add a test
  that fails on new `fontWeight: '800'|'900'` outside the theme.
- **Icons:** replace the `‹ → ›` glyphs with SVG icons drawn like `NavigationIcon` (react-native-svg
  is already a dependency).
- **`styles.ts`:** keep `useAppStyles`. Swap literals for `space`/`radius`/`typeScale`
  mechanically first, then split screen-specific rules into the screens that own them.
- **`gameWorld` is unchanged:** the map stays dark.

### 8.7 Implementation sequence (each step is its own small commit, checks green)

1. `packages/ui`: new roles, `lightTokens`, dark adjustments, type, space, radius, elevation and motion, `toCssVariables`, and the shared AA test over both sets.
2. Mobile foundation: theme preference and providers, `ForceTheme`, Inter loading, `AppText`, theme tests rewritten (not weakened), native appearance config.
3. Admin foundation: CSS variables, bootstrap script, Inter, primitives, no-hex guard, Playwright scaffold.
4. Admin shell, then each area in the §9 order.
5. Mobile: replace `appPalette.*` with roles; the literal-to-token pass on `styles.ts`; then screens by tab (Home, Social, Profile, Run, Map) and onboarding.
6. Theme verification (§9), QA (Phase 7), final report (Phase 8).

### 8.8 Dependencies

| Package                      | Where                      | Why                                             |
| ---------------------------- | -------------------------- | ----------------------------------------------- |
| `expo-font`                  | mobile                     | Inter at runtime (`npx expo install expo-font`) |
| `@fontsource-variable/inter` | admin                      | Self-hosted Inter                               |
| `@playwright/test`           | admin (dev)                | Browser tests and screenshots                   |
| Inter static TTFs            | `apps/mobile/assets/fonts` | Mobile font files plus the OFL licence          |

Nothing is removed. No API, contract, schema or backend change.

## 9. Checklists

### Phase 3 foundation (spec §8.7 steps 1–3)

- [x] 1. `packages/ui`: new roles, `lightTokens`, dark adjustments, `typeScale`, `fontWeight`, space, radius, elevation, motion, `toCssVariables` / `buildThemeCss`, shared AA matrix over both schemes (`border.strong` light darkened to `#86827A` to reach 3:1 on the inset surface)
- [x] 2. Mobile foundation: `ThemeProvider` with a saved preference (light default; Light / Dark / Match phone) and `Appearance` sync; `ForceTheme` (always mounted, optional `scheme`) holds the Map, quest map and live run dark via `isAlwaysDark(shell)`; Inter loaded with `expo-font` and a system-font fallback; `AppText` and `textStyleFor`; `userInterfaceStyle: 'automatic'` in Expo config, Android `strings.xml` and iOS `Info.plist` (hand-edited to match prebuild output); `theme.test.ts` rewritten for light default. **No screen uses `AppText` yet and there is no Appearance setting in Profile yet** (Phase 5).
  - **Intermediate state:** the app now opens light, but six files still read raw `appPalette.*` (Home, PlayScreen, ProfileOverview, `styles.ts`) and many screens assume dark, so the screens look unfinished until Phase 5. Don't ship this branch's mobile build before then.
  - **Not verified:** on-device rendering (light, dark, the Map island, Inter loading, status bars) and that `expo prebuild --platform ios` reproduces the hand-edited `Info.plist` (the iOS CI drift check will say).
- [x] 3. Admin foundation: `buildThemeCss()` baked into `index.html` by a Vite plugin (`theme-plugin.ts`) with a pre-paint script (`theme-bootstrap.ts`), so there's no flash; `theme.ts` (Light / Dark / Match device, saved in `localStorage['rs-theme']`); `styles.css` rewritten to `--rs-*` variables only with focus rings and a real disabled cursor; `@fontsource-variable/inter`; `src/ui/` primitives (`Button`, `StatusTag`, `Notice`, `EmptyState`, `PageHeader`, `Section`, `Field`, `DataTable`, `Dialog`, `ThemeSwitch`); `design-guard.test.ts` (no colour literals, only defined `--rs-*` variables, no heavy weights); Playwright scaffold in `apps/admin/e2e` (`pnpm --filter @runsphere/admin test:e2e`, not in CI) with mocked `/v1`.
  - Added `text.onDanger` to `@runsphere/ui` so the danger button needs no literal.
  - **The primitives and `ThemeSwitch` are not used by the shell yet**; step 4 adopts them. The theme toggle e2e and screenshot baselines wait for that.

### Admin

- [ ] Foundation (CSS variables, theme bootstrap, primitives)
- [ ] Shell and navigation
- [ ] Sign-in
- [ ] Activity review
- [ ] Moderation (reports, appeals, sanctions)
- [ ] Competitions
- [ ] Turf claims
- [ ] Quests
- [ ] Territory seasons
- [ ] Campaign email
- [ ] Privacy requests
- [ ] Data stewardship
- [ ] Support (unbuilt state)

### Mobile

- [ ] Foundation (`typeScale`, `AppText`, spacing and radius migration)
- [ ] Tab bar and screen headers
- [ ] Onboarding, recovery, tour
- [ ] Home
- [ ] Social (friends, clubs, search, profile sheet, shared, invites, notifications)
- [ ] Profile (overview, identity, privacy, zones, achievements, seasons, run log, run detail)
- [ ] Run (picker, route preview, preparation, recording, Ghost Race)
- [ ] Map / Turf (HUD, panels, territory detail, quest detail, explore)

### Verification

- [ ] Theme verification: light and dark on every admin area and mobile screen; map and live run stay dark in both; status bars; no flash on launch or reload
- [ ] Monorepo checks green; no test weakened
- [ ] Final report
