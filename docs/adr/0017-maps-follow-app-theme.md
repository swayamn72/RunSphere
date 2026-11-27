# ADR-0017: Maps follow the app theme

- **Status:** Accepted
- **Date:** 2026-11-27
- **Decided by:** product owner ("when app theme is light show light map or dark"), with the
  live run following too on the design lead's recommendation.
- **Amends:** [ADR-0016](0016-design-system-light-default.md), decision 1, the clause "the Turf map
  and the live run stay dark in both themes". The rest of ADR-0016 stands.

## Context

ADR-0016 made light the app default but kept every map and the live run dark, drawn under a
forced-dark island. On a light phone that means the app jumps from paper to near-black every time
a map opens. The owner asked for a light map in the light theme.

The map provider's style (OpenFreeMap `positron`) is already light; the app was darkening it in
`turf-world-style.ts`. A day variant costs a palette, not a new provider.

## Decision

1. **Every map follows the app theme**: the Turf map, run detail, route preview, quest maps and
   the live run. Light theme draws the day palette, dark theme the night palette.
2. The palettes live side by side in `apps/mobile/src/theme/game-world.ts` (`gameWorld` for night,
   `gameWorldDay` for day) with the same roles, read through `useGameWorld()` or
   `gameWorldFor(scheme)`. `isAlwaysDark` and the forced-dark island are removed.
3. **Lime stays a fill on light** (ADR-0016 decision 2). Lime is 1.14:1 on the day ground, so day
   routes and loops are deep olive and amber-brown, and held ground gets a dark casing under its
   outline. Chips that carry their own background (badges, quest markers, the ghost action) keep
   their night colours in both themes.
4. **3D buildings** (`fill-extrusion` from the tiles' `building` layer) are drawn from zoom 15 in
   both palettes, on by default, with a per-device "3D buildings" switch in the Turf layers sheet.

## Consequences

- `theme.test.ts` checks the day HUD text at AA and day routes, loops and the casing at 3:1 on the
  day ground.
- Changing the theme remounts open maps once (the style is part of the map's key), because
  swapping a style on a live map drops its GeoJSON layers.
- Sunlight readability of the light live run is a device check (release plan), not something
  tests can prove.

## Rollback

Restore `isAlwaysDark` in `navigation/app-shell.ts` and the `ForceTheme` dark island in `App.tsx`,
and pass `'dark'` wherever a map reads the scheme. Both palettes stay valid.
