# Component, placement and layout plan

Status: **partly built (2026-11-25), see §11.** Written 2026-11-25 on `feat/design-system`, after the
colour, type and theme work in [frontend-reconstruction.md](frontend-reconstruction.md) (ADR-0016).
That work made the app consistent in colour and type. This plan is about the next layer: **which
component each job uses, where it sits on the screen, and how it looks and behaves**, to an
enterprise standard that fits runners in Mumbai on mid-range Android phones, plus staff using the
admin console on a laptop.

Sources: the screenshots taken on the iPhone 17 Pro Simulator (light and dark) and the Playwright
screenshots of the admin at 375px and 1280px. Screens nobody has looked at on a device are listed in
§7 and need a quick audit first. Everything below that is marked **Decision** changes behaviour or a
standing rule, so it needs the owner's yes before work starts (CLAUDE.md: ask before product-behaviour
changes).

## 1. Audience and what they need

- **Runners (mobile, Android first, India):** use the app outdoors, one-handed, often in sun, mid-range
  phones, variable network. They want: start a run fast, see their Turf, check friends, trust their
  privacy settings. Never shamed on pace (docs/voice.md).
- **Staff (admin, laptop):** moderators, competition operators, privacy officers. They work through
  queues, need dense tables, clear status, safe destructive actions, and no accidental writes.

## 2. Principles (apply to every component below)

1. **One component per job.** A job (pick one of three, toggle, confirm, navigate to detail) always uses
   the same component, in the same place, with the same states. No one-off variants.
2. **Primary action is obvious and reachable.** Mobile: the main action sits in the lower third (thumb
   zone), above the tab bar, and stays visible while the page scrolls. Admin: top-right of the page
   header or the row's trailing edge.
3. **Hierarchy by position and weight, not decoration.** One title per screen, one primary button per
   view, secondary and destructive actions visibly lower in rank.
4. **Every list and screen has four states designed:** loading (skeleton, not "Loading…" text), empty
   (what's missing and the one way forward), error (`failureMessage`, with Retry), and populated.
5. **Touch targets 44 x 44 pt minimum**, 8 pt between neighbours. Labels never rely on colour alone.
6. **Platform conventions win.** Back is top-left, a bottom sheet for choices and confirmations on
   mobile, a modal dialog on desktop, system switch for on/off. Don't invent controls.
7. **Destructive actions are separated, named plainly, and confirmed.** Never beside a primary action.
8. **Same tokens, same scale.** All new work uses `@runsphere/ui` roles, `typeScale`, `space`, `radius`
   (the guard tests already enforce colours, weights and font sizes).

## 3. Component standard (the shared kit)

Each row: the job, the component, where it goes, and how it should look and behave. The mobile kit
lives in `apps/mobile/src/components/` and the admin kit in `apps/admin/src/ui/`.

### Mobile

| Job                    | Component                | Position and behaviour                                                                                                                                                          |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen frame           | `ScreenShell` + `AppBar` | Safe-area top. Root tabs: large title left, optional trailing action. Pushed screens: back (chevron icon, 44 pt) left, centred title, trailing action right only if it has one. |
| Primary action         | `Button` (filled)        | Full width, 52 pt high, `radius.control`. Sticky bottom bar when the screen scrolls (Start run, Start quest, Save).                                                             |
| Secondary action       | `Button` (outline)       | Same size, below or beside primary.                                                                                                                                             |
| Tertiary / inline      | `TextButton`             | Text only in `text.accent`, 44 pt hit area. Used for "View all", "Refresh".                                                                                                     |
| Destructive            | `Button` (danger)        | Only in its own section at the bottom, after a gap, with a confirm sheet.                                                                                                       |
| Choose one of 2–4      | `SegmentedControl`       | Full width under the title. Labels fit on one line (shorten copy rather than wrap).                                                                                             |
| Choose one of many     | `ListPicker` in a sheet  | Rows with a check mark, not chips that wrap.                                                                                                                                    |
| Filter a list          | `FilterChips`            | One horizontally scrolling row, selected chip filled, not wrapped onto two rows.                                                                                                |
| On / off               | `SwitchRow`              | Label and help text left, switch right, 16 pt vertical padding, one row per setting.                                                                                            |
| Navigate to detail     | `NavRow`                 | Leading icon, label, optional value, trailing chevron icon. One row = one destination.                                                                                          |
| Group of rows          | `GroupedList`            | Inset card with a small caption header above, hairline dividers inside, no card inside a card.                                                                                  |
| Show a figure          | `StatTile`               | Value on top (tabular), label below, both left-aligned, `—` replaced by `0` or a skeleton.                                                                                      |
| Item in a feed or list | `ListItem`               | 64 pt min, avatar or icon left, two lines, trailing meta or chevron.                                                                                                            |
| Status                 | `StatusTag`              | Small pill, words carry the meaning, colour supports it.                                                                                                                        |
| Choices, confirmations | `BottomSheet`            | Handle, title, content, actions at the bottom. Replaces ad-hoc modals.                                                                                                          |
| Transient feedback     | `Toast`                  | Bottom, above the tab bar, auto-dismiss, one line, optional Undo.                                                                                                               |
| Blocking problem       | `InlineNotice`           | At the top of the content it concerns, with the next step.                                                                                                                      |
| Nothing here yet       | `EmptyState`             | Icon, one-line title, one-line reason, one action.                                                                                                                              |
| Loading                | `Skeleton`               | Shapes of the real content. Replace the "Loading standings." text.                                                                                                              |
| Icons                  | `Icon` (one SVG set)     | Replaces the Unicode glyphs (`‹ › →`) so size and weight match the tab icons.                                                                                                   |

### Admin

| Job                    | Component                          | Position and behaviour                                                                                                                    |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| App frame              | `AppShell`                         | Sidebar left (grouped), page header top, content max-width, account menu bottom-left (theme, sign out).                                   |
| Page title and actions | `PageHeader`                       | Breadcrumb, title, description left; primary action right.                                                                                |
| Tabular data           | `DataTable`                        | Toolbar above (search, filters, density, refresh), sticky header, sortable columns, row actions in a trailing `…` menu, pagination below. |
| Row detail             | `Drawer` (right)                   | Opens from a row without losing the table; replaces the always-on side forms.                                                             |
| Create / edit          | `Dialog` or `Drawer` with `Field`s | Primary button bottom-right, Cancel left of it, inline validation under each field.                                                       |
| Confirm a write        | `ConfirmDialog`                    | States exactly what will change; danger variant for lift, rollback, cancel.                                                               |
| Feedback               | `Toast` + `Notice`                 | Toast for success of a row action, `Notice` for page-level state.                                                                         |
| Filters                | `FilterBar`                        | Removable filter pills above the table, "Clear all".                                                                                      |
| Counts and status      | `StatusTag`, `Badge` on nav items  | Queue counts on the sidebar so staff see where work is.                                                                                   |

## 4. Mobile: layout and placement changes by screen

Observed in the Simulator screenshots unless marked otherwise.

### 4.1 Top of screen (all screens) — highest value

- **Observed:** the `LVL 4 · 1,240 XP` chip floats top-right on **every** screen, including settings
  and pickers, and the headers sit under it. On Social and the Run picker this leaves about a fifth of
  the screen empty above the title, and on Settings the title row is pushed down.
- **Plan:** XP is a Home and Profile element. Put it in the Home header (left of the greeting's
  trailing edge) and at the top of Profile. Remove it from the shared shell so every other screen
  starts with its own title. **Decision:** this removes always-visible progression from other tabs.
- **Observed:** pushed screens (Settings, Achievements) show an **empty circle** on the right of the
  title row, balancing the back button. **Plan:** `AppBar` renders a trailing slot only when it has an
  action; otherwise nothing.
- Back button: icon chevron in a 44 pt target, same on every pushed screen. Replace the `‹` glyph.

### 4.2 Home

- Keep: greeting, Turf card (night illustration), weekly goal, quest progress.
- Order by what the runner does next: **1) Start a run** (primary, one tap), **2) the Turf card**,
  **3) this week**, **4) quest progress**, **5) shared with you**. Today the start action sits
  inside the stack with the same weight as the cards. **Decision:** reorder.
- Turf card's two buttons ("Open map", claim action) become one primary and one text action.

### 4.3 Run tab (picker)

- **Observed:** Free run, Turf, Quest are three equal cards with icon, title, line, and a fourth
  outlined "Browse running routes" button.
- **Plan:** `ListItem` cards stay, but **Free run is the default and visually first-class** (filled
  start card or a primary "Start free run" button on top), Turf and Quest follow as options, Routes
  becomes a `NavRow` at the end, not a button that looks like a fourth mode. Copy unchanged.
- **Decision:** emphasising Free run is a hierarchy change only; no behaviour changes.

### 4.4 Quests

- **Observed:** the five filter chips wrap onto two rows, and each card repeats "Open quest" as text
  plus an `OPEN` tag.
- **Plan:** `FilterChips` in one scrolling row. The whole card is the tap target with a chevron, the
  "Open quest" text link goes, the status `StatusTag` stays top-right.
- **Quest detail** (dark island, seen): make **Start quest** a sticky primary bar. The page is a long
  scroll today, so the action is below the fold. Stops list stays; add a compact route summary row
  (distance, time, stops) as `StatTile`s under the map.

### 4.5 Social

- **Observed:** `Friends / Global / Nearby` segmented control is good. "Friends of friends" in
  Settings wraps inside its segment.
- **Plan:** keep the segmented control and "Friend standings". Replace the plain "Loading standings."
  with `Skeleton` rows. Standings rows use `ListItem` with rank (tabular), avatar, name, points
  trailing. Move "Friends and requests ›" to a `NavRow` with a count badge for pending requests,
  placed **above** the standings so requests aren't buried.
- Shorten "Friends of friends" to fit one line, or use a `ListPicker` sheet for audiences with three
  or more long options.

### 4.6 Profile

- **Observed:** centred avatar and name, a tune icon top-right, stat tiles, Achievements, Runs,
  Account, Activity history. "Runs" and "Activity history" both show an empty state with similar
  wording, and Settings is reachable both from a header icon and from a row.
- **Plan:**
  - One entry to Settings: the gear in the header (platform convention), remove the duplicate row.
    **Decision:** removes a way into Settings.
  - Merge "Runs" and "Activity history" into one **Runs** section with one empty state and one
    Refresh. **Decision:** touches a feature surface, so confirm it is the same data first.
  - `StatTile`: left-align value and label (done), replace `—` with `0` or a skeleton while loading.
  - Order: identity, this week, Turf stats, Achievements strip, Runs. No Account block.

### 4.7 Settings (largest change)

- **Observed:** one long scroll with Appearance first, then Goals & activity, You and your friends,
  then privacy toggles and radiogroups inline, Turf, data. Many controls on one page, and long help
  text pushes toggles apart.
- **Plan (iOS "inset grouped" / Android Material settings pattern):** a **short list of groups**, each
  row a `NavRow`, details on their own screens.
  1. **Profile:** Display name and username, Home area.
  2. **Appearance and units:** Appearance (Light / Dark / Match phone), Distance units.
  3. **Notifications:** inbox and delivery.
  4. **Privacy and safety:** one `NavRow` to a **Privacy** screen that holds who can see your runs,
     friend requests, show in search, route maps, start times, hide start and finish, privacy zones,
     safety contacts, Turf name visibility (today's toggles, same keys and API calls).
  5. **Goals:** Weekly progress.
  6. **Friends and clubs:** Clubs, Friends.
  7. **Help:** Replay the tour, Achievements info.
  8. **Data and account** (last, separated): Export data, Delete account (danger text, confirm sheet).
- Keep Appearance reachable in two taps from Profile. **Decision:** a new Privacy sub-screen
  changes the route to those toggles; the settings and endpoints themselves do not change.

### 4.8 Map and live run (always dark)

- **Observed:** the compass, zoom in, zoom out and locate buttons are a four-button stack at the
  top-right, under the status area.
- **Plan:** the **locate** control moves to bottom-right above the sheet or tab bar (thumb zone);
  zoom `+/−` stay hidden behind pinch on touch devices but remain for accessibility (setting);
  compass appears only when the map is rotated. Live run: **Pause/Finish as the one big sticky
  control**, stats in a fixed header with tabular figures, nothing else tappable by accident.
  **Decision:** hiding zoom buttons by default is a behaviour change.

### 4.9 Sheets and overlays

- `GhostRaceSheet`, `RunnerProfileSheet`, `InviteAcceptSheet` move onto one `BottomSheet`
  (handle, title, scrollable body, sticky actions) so they look and drag the same.
- Tour overlays (`TourRho`, `TutorialOverlay`) keep their art; buttons use `Button`/`TextButton`.

## 5. Admin: layout and placement changes

- **Sidebar grouped by job**, not a flat list: **Work** (Activity review, Moderation, Turf claims),
  **Operate** (Competitions, Quests, Territory seasons, Campaign email), **Govern** (Privacy requests,
  Data stewardship), **Support** (unbuilt). Role gating unchanged. Count `Badge`s on queues.
- **Account menu** bottom-left: name, theme switch, Sign out (today the theme switch and sign-out
  are in the top bar).
- **Page header** with breadcrumb, title, description, and the page's primary action top-right
  (Create competition, Create campaign).
- **Tables get a toolbar** (search, filter pills, refresh) and **row actions in a `…` menu**. Click a row
  to open a right-hand **drawer** with detail and the allowed actions, instead of a permanent side
  form. Create forms open in a `Dialog`.
- **Confirmations** for every write that has a real effect: lift sanction, week rollback, cancel
  campaign, set time limit. The dialog restates the change. Request payloads stay identical; the
  existing Playwright request assertions must still pass unchanged.
- **Shortcuts (optional):** `/` focuses search, `g` then a letter jumps to an area. **Decision.**

## 6. Which library for the web admin (needs your decision)

The CLAUDE.md rule and ADR-0016 say **no Tailwind or shadcn**, and shadcn only exists for the web, so
it can't be used on mobile at all. Options for the admin:

| Option                                                                              | Cost                                                                                | Result                                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **A. Keep our own `src/ui` kit** and extend it (Drawer, Menu, Toast, Tabs, Popover) | Most work for focus trapping, keyboard handling and menus; highest a11y risk        | Total control, no new dependencies                                                 |
| **B. Add headless Radix primitives** (the layer shadcn is built on) under our kit   | One new dependency family; styling stays our CSS variables, no Tailwind             | Accessible Dialog, DropdownMenu, Tabs, Toast, Popover for free. **Recommended**    |
| **C. Adopt shadcn/ui with Tailwind**                                                | Tailwind added to the build, a second styling system, ADR-0016 and CLAUDE.md change | Fastest to a familiar look, but doubles the styling approach and fights our tokens |

Recommendation: **B** for the admin only, and keep mobile on its own React Native kit. Choosing B or C
needs an ADR amending ADR-0016. Tell me which you want before I add a dependency. The skills you
mentioned (UI and shadcn) can be used for B's look and structure without installing Tailwind.

## 7. Before building: audit the unseen screens

No one has looked at these on a device yet, so their placement problems are unknown. Do a short audit
first (light and dark, screenshot each, list issues against §2 and §3), then fold the findings in:
quest detail in dark, route preview, recording and results, run detail and charts, clubs, friends,
notifications, privacy zones, account recovery, guided tour, plus the unexplained dark mascot panel on
the privacy onboarding step.

## 8. Phases

| Phase | Work                                                                                                                                                                    | Done when                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| U0    | Audit the unseen screens (§7). Owner answers every **Decision** above.                                                                                                  | Findings added to this file; decisions recorded.                                                  |
| U1    | Mobile kit: `Icon`, `AppBar`, `Button`/`TextButton`, `NavRow`, `SwitchRow`, `GroupedList`, `StatTile`, `Skeleton`, `EmptyState`, `BottomSheet`, `Toast`, `FilterChips`. | Each has a render test and appears once in a kitchen-sink dev screen; no screen uses them yet.    |
| U2    | Shell: remove the floating XP chip, add `AppBar`, restructure Settings into groups and a Privacy screen.                                                                | Same settings keys and endpoints (`api-client` tests unchanged); Maestro walk of Settings passes. |
| U3    | Screens: Home order, Run picker, Quests and Quest detail, Social, Profile, sheets, Map controls.                                                                        | Each screen checked in light and dark on a device; tests updated, none weakened.                  |
| U4    | Admin: shell grouping, account menu, table toolbars, drawers, confirm dialogs (library per §6).                                                                         | Playwright request assertions pass unchanged; new specs cover drawer and confirm flows.           |
| U5    | Verify: lint, typecheck, tests, builds, device and browser pass, final report.                                                                                          | Everything in §9 ticked with evidence.                                                            |

## 9. Acceptance

- Every row in §3 has one implementation and is used wherever its job appears. A search for the old
  patterns (`‹`, ad-hoc `Modal`, per-screen chip rows) returns nothing.
- No API, contract, schema or auth change. Existing endpoint and payload tests pass untouched.
- Light, dark and always-dark islands verified by eye on the Simulator and, before release, on one
  physical Android phone (not yet done anywhere in this project).
- Voice: new strings pass `voice-copy.test.ts`; errors go through `failureMessage`.
- Accessibility: 44 pt targets, labels on every control, visible focus on the web, contrast AA (the
  token matrix already guards colours).

## 10. Decisions needed from the owner

1. Remove the floating XP chip from non-Home screens (§4.1).
2. Reorder Home with Start first (§4.2) and emphasise Free run in the Run tab (§4.3).
3. One Settings entry from Profile; merge "Runs" and "Activity history" after checking they are the
   same data (§4.6).
4. Split Settings into groups with a new Privacy screen (§4.7).
5. Move locate to the thumb zone and hide zoom buttons by default (§4.8).
6. Admin library: A, B or C (§6).
7. Admin shortcuts, yes or no (§5).

## 11. Build status (2026-11-25)

The owner delegated every decision in §10 ("whatever is best for our application and audience"), so
the recommended option was taken for each one. Library choice: **B**, Radix primitives for the admin
only (ADR-0016 amendment).

**Built and checked**

- Mobile: `Chevron` icon replaces the `‹` and `›` glyphs in back buttons and `Setting` rows (and the
  Quests, Clubs and territory back buttons). Pushed-screen headers no longer draw an empty circle.
- Mobile Settings regrouped: Appearance, Account, Privacy & safety, Friends and clubs, Goals &
  activity, Your standing, Help, Data and account (Delete last). The disabled "Activity history" row
  is gone. Same keys, screens and endpoints.
- Mobile: the XP chip shows on the Profile overview only. Profile lost its duplicate Settings row.
  The Quests filter chips are one scrolling row.
- Admin: sidebar grouped Work, Operate, Govern, Support; account menu (appearance, sign out) at the
  foot; `ConfirmButton` with a dialog for upholding or overturning an appeal, rolling a week back
  and cancelling a campaign. No request changed: all 40 Playwright specs, including the exact-payload
  ones, pass.
- Checked on the iOS Simulator (light): Settings, Profile, Run picker. Checked in Chromium
  (screenshot, light desktop): the admin sidebar.

**Added later the same day (checked on the Simulator, light)**

- Home: Start a run now leads, above the Turf card (§4.2).
- Run picker: Free run is the filled lead card, every card has a chevron, and "Browse running routes"
  is a row like the others (§4.3).
- Social: "Friends and requests" is a row above the standings, and standings load as three
  skeleton rows (§4.5).
- Map surface: the recenter button moved to the bottom-right of the map. Seen on the quest detail map
  only; the Map tab has its own toolbar and was not changed (§4.8).

**Not built**

- Mobile kit pieces: `AppBar`, `Skeleton`, `BottomSheet`, `Toast`, `FilterChips`, `GroupedList`
  as shared components. The changes above were made in place on the existing primitives.
- §4.6 merging Runs and Activity history (not merged: not yet confirmed to be the same data),
  §4.8 hiding the zoom buttons and the compass-only-when-rotated rule, §4.4 a sticky Start on the
  quest detail (the screen was only seen with a sample quest), §4.9 one `BottomSheet`.
- Admin: table toolbars and row menus, the right-hand drawer, keyboard shortcuts.
- The unseen screens in §7 are still unseen. Nothing here was run on a physical device or on
  Android.
