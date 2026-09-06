# Screen-by-Screen UX Specification

**Last updated:** 2026-09-06
**Purpose:** Definitive screen-level guide for every flow in RunSphere. An agent building any screen must read this file before writing UI code. Supplements [`map-ux.md`](map-ux.md) (live map detail) and [`territory-guide.md`](territory-guide.md) (territory rules).

---

## Tab Structure

The app has **6 tabs**, always visible in the bottom navigation bar.

```
[ Turf ] [ Home ] [ Explore ] [ Play ] [ Clubs ] [ You ]
   1        2         3          4        5         6
```

**Tab 1 (Turf) is the default tab.** The app opens to Turf every time. No splash screen, no onboarding re-entry, no home dashboard as the first view.

Tab bar items: icon + label. Active tab uses lime accent colour (#AEEF34). Inactive tabs use muted grey.

---

## Onboarding — First Launch Only

Shown once, in sequence. Cannot be skipped except where noted. After completion, the user lands directly on the Turf tab.

### Screen O1: Welcome

- **Background:** Dark (matches app dark theme)
- **Animation:** A lime-green swoosh polyline traces itself across the screen — left to right, curving, then closing into a loop shape
- **Mascot:** Loop character appears at the end of the path animation
- **Copy (Loop says):** "RunSphere is a running game. Run loops, claim ground, defend your territory."
- **Single button:** "Let's go →" (lime background, full width)
- **No stats, no before/after, no pace promises, no comparisons to other runners**

### Screen O2: Age Gate

- **Card centred on dark background**
- **Copy:** "RunSphere is for adults only. Are you 18 or over?"
- **Two buttons:** "Yes, I'm 18+" (lime, primary) and "No" (text-only, destructive)
- **"No" behaviour:** Shows — "RunSphere isn't available for users under 18" — then closes the app
- **"Yes" behaviour:** Records an age assertion (timestamp + policy version). No date of birth collected. Proceeds to O3.

### Screen O3: Location Permission

- **Before** the system dialog, show a custom pre-permission screen:
  - Loop mascot with text: "We need your location to record where you run. Your exact start and end points are never shared — the first and last 200 metres of every route are trimmed automatically."
  - Button: "Grant location access" → triggers the OS permission dialog
- **OS dialog:** Standard Android foreground precise location prompt
- **If granted:** Proceed to O4
- **If denied:** Plain explanation — "RunSphere can't record runs without location. You can grant permission in Settings." — offer "Open Settings" + "Try again". After 2 denials: "Come back when you're ready" — allow entering the app in limited state (can browse but not start a run).

### Screen O4: Choose Your Mascot

- **Grid layout:** 5 mascot cards, 2–3 columns
- **Each card:** illustrated mascot + name + one-line personality

| Mascot | One-liner |
|---|---|
| Loop | Steady. Calm. Guides and explains. |
| Rho | Celebrates consistency. Shows up every day. |
| Mira | Curious. Loves exploring new routes. |
| Coda | Competitive. Loves a challenge. |
| Bram | Strategic. Lives for territory wars. |

- **Selection:** Tap a card to select (lime border). Tap again to deselect and pick another.
- **"Pick later" link** at bottom — skips, defaults to Loop. Changeable in You → Profile later.
- **"This is me →" button** (lime, full width) — only active when a mascot is selected.
- Chosen mascot appears on Turf territory markers, in challenge invites, and in club views.

### Screen O5: Display Name

- **Text input**, pre-filled with name from Google/Apple account. Fully editable.
- **Guidance:** "This name appears on the territory map and leaderboards. You don't need to use your real name."
- **Validation:** 2–30 characters.
- **"Continue →" button** (lime, full width)

### Screen O6: Safety Contact (Optional)

- **Loop mascot, calm tone**
- **Copy:** "Want someone to know you're out running? Add a safety contact. While you run, they'll see a delayed, rough location — never your exact position."
- **Search field:** search by email — sends an invite if the contact is not on RunSphere yet
- **Confirm button:** "Add [Name] as safety contact"
- **"Skip for now" link** — can be added later in You → Safety Contacts
- After skip or confirm → **app opens on Turf tab**. Onboarding complete.

---

## TAB 1: TURF

### 1.1 Turf Map (Primary View)

**Full-screen MapLibre map.** Map fills edge-to-edge including under the status bar.

**Map style:** Dark vector basemap. Streets: slightly lighter grey lines. Buildings: very subtle outlines. Parks: dark green tint.

**Territory polygons:**
- Semi-transparent fill (70% opacity) in the holder's assigned colour
- Solid 2px outline in the same colour, 100% opacity
- Colours assigned deterministically from a 32-colour curated palette — same runner always gets the same colour
- Your own territory: always **lime green** (#AEEF34), 3px outline, rendered above all other polygons in z-order

**Mascot avatar pins:**
- Circular pins at the centroid of each claim polygon
- Holder's chosen mascot illustration inside the circle
- Your own pins: subtle 2-second pulse ring animation
- Low zoom (city scale): individual pins cluster into numbered bubbles ("12 claims here")

**Fixed on-screen controls (never auto-hide):**

```
Top-left:     Season badge     "OCT · 12 days left"
              Rank badge       "#4 in Mumbai"

Bottom-right (stacked vertically):
              [+]  zoom in
              [−]  zoom out
              [◎]  relocate  ← centres map on GPS position

Top-right:    [⋮]  overflow (report a claim, toggle satellite basemap)
```

**Bottom sheet (swipe up):** Leaderboard + takeover feed.

### 1.2 Leaderboard Sheet

**Swipe up from bottom.** Partial height by default (shows top 3 + handle). Drag to full height.

**Three tabs:** My City | My Country | Global

```
#1  [mascot]  Display Name    48,200 m²   ██████████████
#2  [mascot]  Display Name    41,000 m²   ████████████
#3  [mascot]  Display Name    38,700 m²   ███████████
#4  [YOU]     Your Name       31,400 m²   █████████    ← lime highlight
```

- User outside top 50 on Global: their row is pinned at the bottom
- Display name + mascot key only. No location, no route detail.
- "My City" auto-selects based on the user's claim `city_tag`
- No claims yet: "Run your first loop to appear here."

**Secondary tab: Takeover Feed**

```
3 min ago    Runner X carved 8,200 m² from Priya K. in Bandra
1 hr ago     Runner Y defended — Anish tried but wasn't fast enough
Yesterday    New record: Dev S. holds 91,000 m² — Mumbai hall of fame
```

Tapping any event: sheet collapses, map animates to highlight the relevant polygon.

### 1.3 Claim Detail Sheet

**Triggered by tapping any polygon or avatar pin.** Slides up from bottom. Map visible behind a blur.

```
[Mascot avatar — large]   [Holder display name]
"Bandra North — 31,400 m²"

Claimed: Oct 4  ·  14 days ago
Speed to beat: 3.70 m/s
  (run your loop perimeter faster than 5:24/km average)
Their loop: 2.1 km perimeter  ·  11:20 min

[Effort note if applicable]:
  "Their loop was 4× the size of the average claim here.
   You'll need to be within 15% of their pace to contest it."

─────────────────────────────────
[See full history]       [Ghost Race  →]
─────────────────────────────────
```

"See full history": expands to show all previous holders this season, with their speed and dates.

"Ghost Race →": lime button. Triggers Ghost Race confirmation (1.4).

Your own claim: shows "This is your ground." No Ghost Race button on your own territory.

### 1.4 Ghost Race Confirmation Sheet

Slides up over claim detail. Blurred background.

```
[Animated ghost runner — silhouette with dotted trail, looping animation]

"Race against [Name]'s ghost"

[Name] ran this 2.1 km loop in 11:20.
Beat their pace and this territory is yours.

Their route appears on your map as a ghost runner.
Privacy note: The route is trimmed by 200m at both ends.
This run was recorded on Oct 9.

──────────────────────────────
[Start Ghost Race]       [Cancel]
──────────────────────────────
```

"Start Ghost Race" → navigates to Live Running Screen with `ghostTrace` and `claimId` props.

### 1.5 Season Reset Full-Screen Card

Shown once per month, first app open after the season-reset worker completes.

```
[Full-screen confetti animation — lime and white particles]

SEASON ENDED — SEPTEMBER 2026

Your final rank:    #4 in Mumbai
Peak territory:     48,200 m²
Longest-held claim: Juhu Beach — held for 18 days

[Hall of fame card if a record was broken — golden border]
"New Mumbai record: Dev S. held 91,000 m² this season"

New season starts now. The map is clear.

                [Start running →]
```

After 5 seconds or on tap: transitions to Turf map — now empty and dark, season badge shows new month.

---

## TAB 2: HOME

### 2.1 Today Section

```
[Day and date — e.g. "Sunday, October 13"]

[  START RUN  ──────────────────────────────  →  ]   ← large lime button, full width

[Choose a route instead →]    ← secondary link below
```

### 2.2 Territory Summary Card

Shown if user has ≥1 territory claim this season:

```
┌─────────────────────────────────────┐
│ [Mini city map, user's lime polygons highlighted]  │
│                                     │
│ Your Ground                         │
│ 31,400 m² across 4 claims           │
│                                     │
│ Season rank: #4 in Mumbai           │
│ 12 days left in October             │
│                                     │
│ ⚠ Someone ran through your Bandra   │
│   claim. Check Turf →               │
└─────────────────────────────────────┘
```

The ⚠ warning appears if any carve attempt (successful or failed) happened since last app open. Tapping the card → jumps to Turf, highlights the affected claim.

No claims yet:
```
[Bram mascot]
"The city is wide open. Run your first loop to claim some ground."
[Go to Turf →]
```

### 2.3 Weekly Consistency Strip

```
Mon  Tue  Wed  Thu  Fri  Sat  Sun
 ●    ●    ●    ○    ●    ○    ○

3 days this week · 4.2 km average
```

Filled = validated run. Empty = no run. No comparisons. No streak pressure.

### 2.4 XP Progress Bar

```
Level 12 — "Neighbourhood Defender"
████████████░░░░  1,420 / 2,000 XP

+80 XP from this morning's run
```

XP is cosmetic — awarded for active minutes regardless of pace. Does not affect territory.

### 2.5 Active Quest Card

```
[Mira mascot — small, left-aligned]
"Complete a loop around Worli Sea Face"
Tap to preview on map →
```

Shows first active quest. Tap → opens Explore tab filtered to that quest.

---

## TAB 3: EXPLORE

### 3.1 Route Suggestion Carousel

Three cards, swipeable: Short, Medium, Long.

```
  ←  [ Short  ·  2.1 km  ·  ~12 min  ]  →
```

Each card:
- Small map thumbnail with the route polyline drawn on it
- Distance and estimated time
- Whether the route passes near existing territory (coloured segments)

Tapping a card → the map below updates to show that route's loop.

**Tuning controls below the carousel:**
```
Distance:  [─────●────────]  2.1 km    [-]  [+]

  — or —

"I have: [    ] minutes"   ← text input, recalculates distance
```

Adjusting distance or time: route card's map redraws with new loop shape (fetch from server or local cache, ≤1 second).

```
[ Use this route ]    [ Start without route ]
```

"Use this route" saves the loop as a guide overlay for the next run. Guide is reference only — no penalties for going off-route.

### 3.2 Quest List

```
[ Shivaji Park Loop ]
Complete a closed loop around Shivaji Park
★ 120 XP · Est. 5.2 km · Expires Nov 1
[Preview on map →]

[ Worli Sea Face ]
Run the full Worli Sea Face promenade
★ 80 XP · Est. 3.1 km
[Preview on map →]
```

Tapping "Preview on map →": full-screen map with checkpoint markers. "Accept quest" adds it as an overlay to the next run.

No quests available:
```
[Mira mascot]
"No quests near you right now. Try a free run and explore."
```

---

## LIVE RUNNING SCREEN

### LR.1 Map

Full-screen MapLibre. Dark basemap. Same visual language as Turf tab.

**Runner position:** Large pulsing lime dot (20dp radius).

**Live path trace:** Solid lime polyline, 4dp wide, grows in real time every 5 seconds from accepted GPS points in local encrypted SQLite. Never fetched from server during an active run.

**Camera:** Auto-follow. Runner stays in the lower-third of the screen. Camera rotates to match heading direction. Manual pan → auto-follow pauses, relocation button becomes highlighted.

**Right-edge controls (always visible):**
```
[+]  zoom in
[−]  zoom out
[◎]  relocate  ← highlighted when auto-follow is paused
```

**If route guide active:** Dashed white polyline shows the suggested loop. Static from run start — does not update.

**If Ghost Race active:**
- Silver/white polyline advances along ghost trace at holder's original pace
- Translucent ghost avatar icon at the front of the ghost polyline
- **Live comparison card** (top of screen):
  ```
  You: 4:12 elapsed    Ghost: 4:31 elapsed
  ▲ You're 19 seconds ahead
  ```
  Updates every 5 seconds. Green when ahead, amber when close, red when behind.

**If quest checkpoint active:** Coloured ring markers on the map. Within 50m → ring pulses. Passing through → ring fills, haptic fires, toast: "✓ Checkpoint 2 of 3".

### LR.2 Bottom Control Strip

```
[  4.2 km  ]  [  21:30  ]  [  LIVE ●  ]
  distance     elapsed      GPS status

[■ Stop run]                    [⏸ Pause]
```

GPS status:
- 🟢 ≤50m accuracy
- 🟡 50–100m (flagged samples, run continues)
- 🔴 >100m or no fix (rejected samples, non-alarming toast: "GPS signal is weak — your route is still recording.")

Pause → freezes recording. A "Resume" button replaces the map. Paused time not counted as active minutes.

### LR.3 Post-Run: Loop Detection

2-second calculation animation after tapping Stop.

**Loop detected:**
```
Loop detected ✓

Enclosed area:   18,400 m²
Loop perimeter:  2.3 km
Time:            11:54 min
Speed:           3.22 m/s average

[ Claim this territory ]    [ Just save the run ]
```

**Loop overlaps existing territory:**
```
⚠ This loop overlaps 2 existing claims
  · 6,200 m² of Priya K.'s ground (Bandra)
  · 3,800 m² of Arjun M.'s ground (Worli)

Your speed and effort will be compared to each holder.
Checking now...
```

After server validation (3–8 seconds):
```
Results

✓  You carved 6,200 m² from Priya K.
   Your speed: 3.22 m/s · Hers: 3.10 m/s · Grace applied: 0%

✗  Arjun M.'s ground held.
   Your effective speed: 3.54 m/s (10% grace applied)
   His speed: 3.70 m/s — he was faster

[View on Turf →]    [Share run]
```

**No loop detected:**
```
No loop this time

Your run is saved. Keep going — close a loop on your next
run to claim some ground.

[Rho mascot]  "Nice run. 4.2 km."
[Done]
```

---

## TAB 4: PLAY

### 4.1 Friend Leaderboard

```
This Week — Active Minutes (mutual friends)
─────────────────────────────────────────
#1  Priya K.   ████████████  142 min
#2  Dev S.     ██████████    118 min
#3  [YOU]      █████████     104 min
#4  Anish M.   ████           48 min
```

**Automatic** — all mutual friends appear. No toggle. No opt-in.
Blocking a friend removes them instantly and permanently.
<2 mutual friends: Coda mascot prompts to invite friends by email.

### 4.2 1v1 Challenge

```
[Coda mascot]
"Challenge a friend to a 3 or 7-day battle."

Active challenge (if any):
┌──────────────────────────────────┐
│  Dev S.  vs  You  — 3 Day Battle │
│  Ends: Tuesday, 11:59 PM         │
│  Dev:  118 min  █████████████    │
│  You:  104 min  ████████████     │
└──────────────────────────────────┘

[Challenge Dev S.]    [Challenge Priya K.]
Duration: [3 days]  [7 days]  [Custom]
Win condition: Most active minutes

[Send Challenge]
```

Pending sent challenges: listed separately, can be cancelled.
Received challenges: "Dev S. challenged you. 3-day battle. Accept?" with Accept/Decline.

### 4.3 Global Opt-In Board

```
[Globe icon]
Join the Global Weekly Board
Your display name will be visible to everyone.

[Join Global Board]
```

Once joined:
```
Global Board — This Week
#1,204  You  ·  104 min
(38,400 active runners this week worldwide)
[Leave global board]
```

### 4.4 Competitions

```
[ Mumbai Territory Championship — Oct 2026 ]
Claim the most ground in Mumbai this month.

  #1  Arjun M.   48,200 m²
  #4  You        31,400 m²

Ends: Oct 31, 11:59 PM IST
[Rules]   [View on Turf]
```

---

## TAB 5: CLUBS

### 5.1 Your Clubs List

```
[ Bandra Runners ]
  12 members · Club relay: 680 / 1,000 min this week
  [Open →]

[ + Create or join a club ]
```

### 5.2 Club Detail Screen

```
[ Bandra Runners ]
12 members  ·  Code: XK-4429

Weekly Relay — 680 / 1,000 active minutes
[████████████░░░░░░░░]  68%  Target: Sunday midnight IST

Member contributions this week:
  Priya K.   80 min  (capped at 80)
  Dev S.     75 min
  You        60 min
  Anish M.   30 min

[ Club Leaderboard ]      [ Challenge another club ]
[ Invite member ]         [ Leave club ]
```

Club leaderboard is private — visible to members only. Not searchable by non-members.

### 5.3 Create / Join

**Create:** name (3–40 chars), auto-generated invite code, max 50 members (V1).
**Join:** Enter invite code (format: XX-NNNN) → club name confirmed before joining.

---

## TAB 6: YOU

### 6.1 Run History

```
Today      4.2 km · 21:30 · Loop claimed ✓
Oct 9      6.1 km · 32:45 · Ghost Race — defended Worli Claim ✓
Oct 7      3.0 km · 18:10 · No loop
Oct 5      7.2 km · 41:00 · Loop claimed + 2 areas carved
```

Tapping any run → full run summary: map replay (start/end hidden), split times per km, territory outcome, XP earned.

### 6.2 Achievements

```
[ First Claim ]     ✓  Oct 4         "Planted your flag."
[ 5 Runs ]          ✓  Oct 8         "Showing up."
[ 100 km Total ]    ○  82/100 km
[ Ghost Buster ]    ○  Win a Ghost Race
[ Season Top 10 ]   ○  Finish in top 10 of your city
[ 10 Claims ]       ○  Hold 10 simultaneous claims
```

All achievements are cosmetic. None unlock gameplay advantages or territory benefits.

### 6.3 XP and Level

```
Level 12 — "Neighbourhood Defender"
████████████░░░░  1,420 / 2,000 XP

Level history:
  Level 11 — "Regular Runner"     earned Oct 1
  Level 10 — "Consistent Mover"   earned Sep 18
```

### 6.4 Privacy Zones

```
Privacy Zones
  [🏠 Home]    hidden from all routes     [Edit]  [Remove]
  [🏢 Work]    hidden from all routes     [Edit]  [Remove]

Runs that pass within 200m of these locations are
automatically trimmed server-side.

Turf loops that come within 200m are REJECTED — not trimmed.
A partial loop is not a valid claim.

[Add a zone]    (max 3 zones)
```

### 6.5 Safety Contacts

```
Safety Contacts
  Mum  ●  Active during runs     [Remove]

While you're running, Mum sees:
  · A delayed location (15+ min behind real time)
  · At coarse accuracy (≥500m radius)
  · Not your exact path or start/end point
  · Automatically stops when your run ends

[Add another contact]    (max 3)
```

### 6.6 Account and Data

```
[ Export my data ]
  Downloads all runs as GPX. Territory claim history included.

[ Delete my account ]
  Permanent. 30-day waiting period.
  All runs, claims, XP, and friends are deleted.
  Territory held by you is immediately released.

[ Community Guidelines ]
[ Privacy Notice ]
[ Terms of Service ]
[ App version: 1.0.0 ]
```

---

## Push Notification Catalogue

All 12 notification types the worker must implement.

| ID | Trigger | Message copy | Tap action |
|---|---|---|---|
| `CARVE_SUCCESS` | Your territory carved | "[Name] ran through your ground in [area]. They took [Xm²]. You still hold [Ym²]." | Turf → highlight claim |
| `CARVE_DEFENDED` | Carve attempt failed | "[Name] tried to take your ground in [area]. They weren't fast enough. Your claim stands." | Turf → highlight claim |
| `GHOST_INCOMING` | Ghost Race started on your claim | "[Name] is racing your ghost right now." | Turf → highlight claim |
| `WEEKLY_RANK` | Monday rank snapshot | "Week summary: Rank #[N] in [City] · [Xm²] held." | Turf → leaderboard |
| `SEASON_ENDING_3D` | 3 days before reset | "Season ends in 3 days. You hold rank #[N] with [Xm²]. Keep running." | Turf |
| `SEASON_ENDED` | Monthly reset completed | "Season ended. Final rank: #[N] in [City]. Peak: [Xm²]. New season starts now." | Turf → season recap |
| `QUEST_AVAILABLE` | New quest assigned | "New quest near you: [Name] · [XP] XP" | Explore → quest |
| `QUEST_COMPLETE` | Quest validated | "[Quest Name] — done. +[XP] XP." | Home → XP |
| `CHALLENGE_RECEIVED` | 1v1 invite received | "[Name] challenged you. [N]-day battle. Active minutes. Accept?" | Play → challenge |
| `CHALLENGE_WON` | 1v1 ended, you won | "You beat [Name]. [X] min vs [Y] min." | Play |
| `CHALLENGE_LOST` | 1v1 ended, you lost | "[Name] edged you. [X] min vs [Y] min. Rematch?" | Play |
| `STREAK` | Consistency milestone | "[N] runs in a row. Rho is watching." | Home |

**Rules for all notifications:**
- No raw location, route, or activity detail in any message body
- Sender identity: display name only — never email or phone
- Blocked users never appear in any notification
- Per-type on/off preferences managed in You → Settings → Notifications

---

## Empty States

Every screen must handle empty state gracefully. Never show a blank screen.

| Screen | Empty condition | Mascot | Message |
|---|---|---|---|
| Turf map | No claims this season | Bram | "The city is wide open. Run your first loop to claim some ground." |
| Leaderboard — My City | No runners in your city yet | Bram | "No one has claimed ground here yet. Be the first." |
| Leaderboard — Global | User not on global board | Loop | "Join the global board in the Play tab to see your global rank." |
| Home — Territory card | No claims | Bram | "The city is wide open. Run your first loop to claim some ground." |
| Explore — Quests | No quests available | Mira | "No quests near you right now. Try a free run and explore." |
| Play — Friend board | <2 mutual friends | Coda | "Add friends to see how you stack up. Invite by email." |
| Clubs | No clubs | Coda | "You're not in any clubs. Create one or join with an invite code." |
| You — Run history | No runs | Loop | "No runs yet. Start your first run from the Home tab." |
| You — Achievements | No achievements | Rho | "Your first achievement is one run away." |
