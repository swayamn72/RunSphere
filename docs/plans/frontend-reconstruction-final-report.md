# Frontend reconstruction: final report

Date: 2026-11-25. Branch: `feat/design-system` (not merged to `main`). Spec and checklists:
[frontend-reconstruction.md](frontend-reconstruction.md). Layout pass:
[component-and-layout-plan.md](component-and-layout-plan.md). Decision record:
[ADR-0016](../adr/0016-design-system-light-default.md).

## What you have now

- **One design system for both apps.** `@runsphere/ui` holds the tokens: light and dark colour roles,
  type scale (Inter, four weights, tabular figures), spacing, radius, elevation and motion. The admin
  reads them as CSS variables. The mobile app reads them through `useAppTheme()`. Light is the default;
  Dark and Match device are options in both. The Turf map and the live run stay dark in both.
- **Brand kept, accent fixed.** TURFR lime stays the accent, as a fill (yours, selected, primary).
  Text on light uses an olive that passes AA. Orange was not adopted; the reasons are in ADR-0016.
- **Mobile:** Inter everywhere, the heavy 800 and 900 weights gone, ten font sizes instead of 28,
  an Appearance setting, regrouped Settings, one icon set for back and forward arrows, a Home that
  leads with Start, a Run picker that leads with Free run, a Social screen with requests above the
  standings, the XP chip on Profile only, one shared `BottomSheet` and `Toast`, a pinned Start on
  quest detail, and every on-scale spacing and radius value written as a token.
- **Admin:** a rebuilt shell with a grouped sidebar and an account menu; every area on shared
  primitives; searchable tables; create forms in dialogs that stay open on a refusal and show it;
  a details drawer for review submissions; a schedule drawer for campaigns; a row menu with confirm
  on competitions; confirm dialogs for appeals, week rollback and campaign cancel; `/` focuses the
  search; the open area is in the address bar.
- **Guards that keep it that way:** no colour literals (both apps), no heavy weights, only scale font
  sizes, no direct React Native `Text`, on-scale spacing and radius spelled as tokens, defined CSS
  variables only in the admin, and a contrast matrix over both themes.

## Evidence

| Check                                         | Result                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`                 | pass, 0 errors                                                                                                                                                                                                          |
| `pnpm test`                                   | pass: mobile 1,006, admin 85, domain 587, api 512, worker 166, ui 18, others                                                                                                                                            |
| Admin Playwright (mocked `/v1`, Chromium)     | 46 specs pass, including exact method, path and body for every form                                                                                                                                                     |
| Admin build, `expo export --platform android` | succeed                                                                                                                                                                                                                 |
| Prettier (CI flags)                           | clean on every changed path                                                                                                                                                                                             |
| iOS Simulator, iPhone 17 Pro                  | seen by eye: light and dark Settings, Profile, Achievements; light Home, Run picker, Quests, quest detail, Social, Weekly goals, Change email, Privacy & visibility, Safety & privacy, Fair Play sheet; Map tab in dark |
| Admin by eye                                  | every area at 375, 768 and 1280 px in both themes (screenshots from the e2e run)                                                                                                                                        |

PostGIS integration suites skip without the test database; no backend, contract, schema or API code
was changed, so they were not re-run.

## Not verified, and why it matters

- **Android and any physical phone.** Nothing was run on either. The target audience is Android first.
  Inter loading, the status bar and the new `automatic` appearance setting need one pass on a real
  device after a new native build.
- **iOS native config.** `Info.plist` was hand-edited to `Automatic`; the CI drift check against
  `expo prebuild` has not been run.
- **Screens never opened on a device:** route preview, activity recording and results, run detail and
  charts, clubs, friends, notifications, privacy zones, achievements list, account recovery, the
  guided tour, and quest detail in dark. You accepted these without device verification on
  2026-11-25. That is an acceptance, not a test result.
- **Quest detail's pinned Start** was only seen with a sample quest, which has no Start. Its logic is
  unchanged and tests pass.
- **Admin in Firefox and Safari.** Only Chromium was used.
- **Contrast of the map and live-run islands** was not re-measured; they were left as they were.

## Left alone on purpose

- Off-scale spacing values (3, 5, 6, 7, 10, 13, 14, 15, 18...) stay literal. Snapping them changes how
  things look and needs a designer's eye.
- "Runs" and "Activity history" on Profile are different data (counted runs from the server vs
  recordings on this phone, including ones not yet counted), so they are not merged.
- Map zoom buttons stay for accessibility. The recenter button moved to the thumb zone.
- Inline text links such as "Friends and requests ›" in a sentence keep their typographic arrow.
- Staff access is unchanged. Activity review is still offered to any signed-in account, with the
  server deciding (an owner decision, noted earlier).

## Things I noticed that are not design

- "MVP · ANDROID V1" shows as a pill on the Safety & privacy screen. It reads like a leftover.
- The Expo dev client's floating gear is not part of the app.
- A dark panel with a dark mascot appeared once on the privacy onboarding step and could not be
  traced to any code. Re-check on a fresh sign-up.
- A throwaway account (`design-review@example.com`) exists in the local dev database.

## Suggested next steps

1. Build the Android app and walk the screens above in light and dark on a real phone.
2. Run the iOS CI drift check and merge when green.
3. Decide the off-scale spacing values with a designer.
4. Run Playwright in Firefox and WebKit if staff use them.
