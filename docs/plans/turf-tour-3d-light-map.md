# Turf story tour, 3D map and replay, light map — implementation plan

**Status:** built 2026-11-27 (Phases 0–4); Phase 5, the phone pass, is left. The owner said go ahead
with the recommended answers to the open decisions (see the end).

**References** (inspiration for mechanics and feel only; we build our own look and copy, not
theirs):

- `docs/assets/maptour.jpg`: a step-by-step tour played out on the map itself (step card with
  progress bars, eyebrow, title, one line of body; Back, Skip, Next; the map animates each step).
- `docs/assets/6d176a99-563c-4d9d-87e7-7a1382ede40a.jpg`: a pitched 3D run replay with extruded
  buildings, a route coloured by pace, a slow/fast legend, live stats and play controls.

## What already exists (verified in code, 2026-11-27)

| Piece                                          | Where                                                    |
| ---------------------------------------------- | -------------------------------------------------------- |
| Spotlight tour with Rho, per-account memory    | `tutorial-model.ts`, `TutorialOverlay.tsx`, `TOUR_STEPS` |
| Pace-coloured route (`line-gradient`), draw-in | `route-draw-model.ts` (`paceStops`, `gradientForSlice`)  |
| Run detail map with fit, start/finish markers  | `RunDetailMap.tsx` → `MapSurface.tsx`                    |
| Pitched Turf camera (52°)                      | `TurfScreen.tsx` `INITIAL_PITCH`                         |
| Dark "world" restyle of the provider style     | `maps/turf-world-style.ts`, cached per session           |
| Provider style is **light** (`positron`)       | `EXPO_PUBLIC_MAP_STYLE_URL` (OpenFreeMap)                |
| Sample claims for previews                     | `previewClaims` in `TurfScreen.tsx`                      |
| Carving rule (overlap goes to the faster loop) | `packages/domain/src/territory-claim.ts`                 |

Note: `docs/territory-guide.md` (carving) matches the code. ADR-0011's "takes the whole claim
at ≥60% overlap" is out of date and should be corrected in the same PR as the tour copy.

---

## Feature A — "How Turf works" story tour

A full-screen, map-backed walkthrough that **plays out** the game in five short scenes. It is
separate from the existing spotlight tour (that one teaches where buttons are; this one teaches
the game).

### Scenes (copy drafts — run through `docs/voice.md` and Rho's tone test before shipping)

| #   | Eyebrow | Title               | Body                                                                      | Map animation                                                                                                      |
| --- | ------- | ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | RUN     | Close a loop        | Run a loop and finish near where it started.                              | A line draws round a block and closes; start dot pulses at the close.                                              |
| 2   | CLAIM   | The inside is yours | Claim the run and the ground inside goes on the map with your name.       | Loop fills lime; your flag/avatar pops in; area counter ticks up ("12,400 m² yours").                              |
| 3   | STEAL   | Take their ground   | Loop through a rival's ground faster than they did. The overlap is yours. | Camera tilts; a rival's area shows; your faster loop crosses it; overlap flashes and turns lime; "4,800 m² taken". |
| 4   | DEFEND  | Hold it             | Someone faster can take it back. Race their ghost to win it again.        | A rival line cuts in; your area flashes contested; Ghost Race chip appears.                                        |
| 5   | SEASON  | New map every month | Ground resets on the 1st. Hold the most by month end.                     | Camera pulls out over the city; claims fade; season badge.                                                         |

Rules the copy must not contradict: claims are explicit (you choose to claim); 5,000 m² minimum;
speed decides a steal, ties go to the holder; seasons are calendar months (`season_month`).
Never shame pace (voice.md): "faster than they did", never "too slow".

### How it's built

- **`turf-story-model.ts`** (pure, tested): the scene list, and synthetic scene geometry built in
  metres around a fixed demo centre and converted to lng/lat. The demo players are made up. No
  real claims, users or coordinates are involved, so nothing private is shown. Areas shown in the
  scenes are computed from these same polygons so the numbers are honest.
- **`TurfStoryScreen.tsx`**: one MapLibre `Map` using the cached Turf style (dark or light per
  theme, see Feature C), with `GeoJSONSource`/`Layer`s for the scene. Each scene has:
  - a camera stop (`cameraRef.setStop` with centre, zoom, pitch, bearing, duration);
  - a timeline of layer states driven by one `requestAnimationFrame` loop capped at 30 fps (the
    same slicing approach as `route-draw-model.ts`; reuse `sliceRoute`);
  - the card (progress bars, eyebrow, title, body), Back/Skip at the top, Next at the bottom.
- **Reduce motion:** each scene jumps to its end state, with no camera flights.
- **Accessibility:** the card is a live region; the map is `importantForAccessibility="no"` with
  the scene described in the card; Next/Back/Skip are 48 dp targets; Android back = Back.
- **When it shows:**
  1. Automatically on the **first Map tab visit** after the spotlight tour is done (one per account,
     same `TourStore` pattern with its own key and `TURF_STORY_VERSION`).
  2. "How Turf works" in the map info sheet (`mapInfoOpen`) and in Settings, next to "Replay the
     tour".
- **Performance:** the screen reuses the cached style (no extra style download). It renders over
  the Turf tab, which stays mounted and hidden, and the story map is released when the story
  closes.

### Tests

- Model: scene count and order, polygons valid and closed, overlap area > 0 and < rival area,
  numbers shown equal computed areas, the store remembers completion per account.
- Render: Next/Back/Skip move through scenes; reduce motion shows end states; copy passes
  `voice-copy.test.ts` and Rho's tone test.

---

## Feature B — 3D map and run replay

### B1. 3D buildings (Turf map, run detail, route preview)

- Add a `fill-extrusion` layer from the vector tiles' `building` layer (OpenMapTiles schema:
  `render_height`, `render_min_height`), inserted **below** labels and claim layers:
  `fill-extrusion-height: ['get','render_height']`, base `render_min_height`, `minzoom: 15`,
  opacity ≈ 0.7, colours per theme from `game-world.ts`.
- Done once in the style transform (`turf-world-style.ts` → becomes `turfMapStyle(style, scheme,
{ buildings })`), so every map gets it.
- Before building, verify against the live positron style that the source id and `building`
  source-layer exist. It's one fetch, and the transform can fall back to flat when they're absent.
- **Toggle:** a "3D buildings" switch in the map layers sheet, default on and remembered per
  device. Extrusions only render from zoom 15, so zoomed-out views cost nothing.
- No terrain: OpenFreeMap has no elevation tiles and Mumbai is flat. Not worth a second provider.

### B2. Run replay ("Replay" on run detail)

- A Replay button on `RunDetailScreen` opens a full-screen replay over `MapSurface`:
  - camera at pitch ~60°, zoom ~16.5, **following** the moving head with bearing along the
    direction of travel (smoothed, as `use-turf-position.ts` already smooths bearing);
  - the route draws behind the head with the existing pace gradient (`paceStops` +
    `gradientForSlice`);
  - top: **pace legend** "Quicker 5:05 → Easier 15:07" using the run's own quickest/slowest
    pace (relative to the run itself; voice.md). Colours stay ours: lime (quicker) → amber
    (easier), not green→red, because red reads as "bad" and is already a rival colour on the map;
  - live stats: distance so far, moving time so far, average pace so far (time at each distance
    comes from integrating `paceSeries`);
  - controls: Play/Pause, scrub (reuses the chart cursor from 9.19), speed 1×/2×/4× (a whole replay takes 30 s at 1×; the dot lingers where you ran slower), and a
    "Whole route" button that ends the replay and fits the route.
- **Camera cost:** updating the camera every frame over the bridge is jumpy. Instead, issue
  `setStop` every ~200 ms with `duration: 200` and `easing: linear` so the native side
  interpolates between stops. Pause when the app is backgrounded.
- **Privacy:** only geometry the server already returns for that run (privacy-trimmed, ADR-0002).
  Other people's runs replay only where their run detail is already visible to you.
- **Reduce motion:** no follow camera. Show the full drawn route with the scrubber.

### Tests

- Model: time-at-distance from `paceSeries`, head position at a time, bearing smoothing,
  legend numbers equal the run's min/max pace, speed multipliers.
- Render: play/pause/scrub; reduce-motion path; the legend uses voice-approved words.

---

## Feature C — Light map when the app is light

### Product rule change

ADR-0016 decision 1 says "the Turf map and the live run stay dark in both themes". This needs a
new **ADR-0017 "Maps follow the app theme"** that supersedes that clause (keeping the rest of
ADR-0016). Live run: see open decision 1.

### How it's built

1. **Palette:** split `gameWorld.map` into `gameWorld.map.night` (today's colours) and
   `gameWorld.map.day` (new: paper ground, soft blue water, pale green parks, grey roads, dark
   labels). Hex stays in `game-world.ts` (the only place `theme.test.ts` allows it).
2. **Style transform:** `turfMapStyle(style, 'light' | 'dark')`. Light starts from the positron
   style itself (already light) and applies the day palette so it matches the app's paper tone.
   The cache in `turf-world-style-cache.ts` keys by `url + scheme`, and both are prefetched after
   sign-in.
3. **Shell:** `isAlwaysDark(shell)` in `navigation/app-shell.ts` stops returning true for
   `tab-map`/`focused-map` (still true for live run if decision 1 keeps it dark). `ForceTheme`
   then passes the user's scheme to the map screens.
4. **Map remount on theme change:** the `Map` `key` includes the scheme (style swaps on a live map
   drop GeoJSON layers; the existing comment in `TurfScreen.tsx` explains why). The kept-alive
   Turf tab remounts once when the theme changes. That's acceptable.
5. **Everything drawn on the map needs a light version:**
   - claim fills/outlines (`OWNER_PALETTE`, yours = lime fill with dark outline), contested pulse,
     fog (dark veil at low opacity on light), grid, event areas, cluster bubbles;
   - HUD glass (`gameWorld.hud.*`): light glass with ink text;
   - markers/avatars: dark rim on light;
   - route colours: lime on paper is 1.14:1 and fails contrast as a thin line, so light uses deep
     olive `#3F5A00` (quicker) → amber-brown (easier), or lime with a dark casing.
6. **Contrast:** extend `theme.test.ts` so every map/HUD role passes AA (text) or 3:1 (graphics)
   against its own ground, in both schemes.

### Tests

- Style transform for both schemes (layers kept, palette applied, extrusion present/absent).
- Cache keys by scheme; the theme switch remounts the map exactly once.
- Contrast tests above; the existing render tests run in both schemes.

---

## Phases (each a separate branch + PR, owner's workflow)

| Phase | Scope                                                                                                                              | Size            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 0     | ADR-0017 (maps follow theme), fix ADR-0011 steal wording, verify positron building layer                                           | S               |
| 1     | **Light map** (Feature C): palette, transform, cache, shell, all overlays, contrast tests                                          | M–L             |
| 2     | **3D buildings** (B1) + layers toggle                                                                                              | S               |
| 3     | **Story tour** (Feature A): model, screen, triggers, copy review                                                                   | L               |
| 4     | **Run replay** (B2): model, screen, controls, legend                                                                               | L               |
| 5     | Device pass on a mid-range Android: frame rate in 3D, memory with kept-alive map + story/replay, sunlight readability of light map | S (needs phone) |

Light map goes first because the tour and replay both draw on the map, so building them after
means their colours are designed once for both themes.

## Risks

- **Frame rate on low-end Android** with extrusions + animated GeoJSON. Mitigations: zoom ≥15
  for buildings, 30 fps cap, the toggle, and replay camera stops instead of per-frame moves.
- **Provider style changes** (OpenFreeMap renames a layer) silently flatten 3D or unstyle the
  map. The transform already falls back; add a test with a pinned style fixture.
- **Copy drift from the rules.** The tour states game rules; if the carving rule changes, the
  tour must change with it. Keep scene copy next to the rule constants and test the numbers.

## Decisions (resolved 2026-11-27 with the recommended answers)

1. **Live run map in light theme:** follow the theme (better in sunlight, recommended) or stay
   dark?
2. **Story tour trigger:** auto on first Map visit (recommended) or only from "How Turf works"?
3. **3D default:** on, with a toggle (recommended), or off by default?
4. **Pace colours:** keep TURFR lime → amber (recommended) or the reference's green → red?
