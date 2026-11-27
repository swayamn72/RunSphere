# ADR-0016: One design system, light by default

- **Status:** Accepted; decision 1 amended by [ADR-0017](0017-maps-follow-app-theme.md) (maps follow the app theme)
- **Date:** 2026-11-25
- **Decided by:** product owner (frontend reconstruction brief, answered 2026-11-25). The accent and
  typeface were delegated to the design lead "on merit, not ease"; the reasoning is recorded here.
- **Amends:** the [TURFR mobile handoff](../plans/turfr-ui-rebrand.md). Its palette stands; its
  dark-only appearance does not.

## Context

The mobile app shipped one dark appearance, pinned by `theme.test.ts`, `app.config.ts` and the
Android `strings.xml`. The admin console used an unrelated light green palette with no shared
tokens. The reconstruction brief asked for one design system across both, light by default with
an optional dark theme, and proposed an orange accent.

## Decision

1. **Light is the default** in both apps. Dark is optional. Each app offers Light, Dark and
   Match device, stored per device. The Turf map and the live run stay dark in both themes:
   map legibility and the game world are designed for night, and the handoff already required it.
2. **The accent stays TURFR lime `#C9F44A`.** On light surfaces it's a fill, never text: primary
   buttons are near-black with paper text (the volt-on-black pattern), and lime marks what's
   _yours_ and _selected_ (your Turf, active tab, progress, the selected chip) with ink on top.
   Accent text on light uses deep olive `#3F5A00`.
3. **The typeface is Inter** in both apps, in four weights (400, 500, 600, 700), with tabular
   figures for every stat, timer and pace. Weights 800 and 900 are retired.

## Why lime, not orange

- Contrast: neither colour works as text on a light surface. Lime measures 1.14:1 on the canvas
  and orange `#F05A28` measures 3.03:1. White on an orange button is 3.39:1, below AA. Orange would
  need darkening for every label, which removes the reason to pick it.
- Differentiation: `#F05A28` is close to Strava's `#FC4C02`, the app this audience already runs
  with. TURFR would read as a copy.
- The map: the neutral-zone and warning colour is amber. Orange beside it blurs ownership.
- Brand equity: the launcher icon, splash and Play assets already ship in lime.

## Why Inter, not system fonts

TURFR is Android-first in India, where Samsung, Xiaomi and Realme phones ship their own system
faces, and users can switch them. React Native's default text follows that choice. Numeral
widths, line heights and the brand then vary by handset. Inter fixes one face on every device
and the web. It has true tabular figures and is built for small UI sizes, and it is OFL-licensed.
Mobile loads it at runtime with `expo-font` so the hand-edited native projects don't need
`prebuild`. If loading fails, the app falls back to the system font.

## Consequences

- `@runsphere/ui` gains `lightTokens`, a type scale, weights, elevation and motion tokens, and
  a CSS-variable bridge for the web. Existing exports keep their names.
- `theme.test.ts` changes from "dark-only" to "light default, dark optional, both themes AA".
  The no-hex guard and the AA matrix stay, and now cover both themes.
- `userInterfaceStyle` becomes `automatic` (Expo config, Android `strings.xml`, iOS
  `Info.plist`). That needs a new native build. The splash stays brand near-black.
- New dependencies: `expo-font` (mobile), `@fontsource-variable/inter` (admin), and
  `@playwright/test` (admin, dev only).

## Rollback

Set the default preference back to `dark` in `theme-state.ts`. Both token sets stay valid.

## Amendment (2026-11-25): headless menus in the admin

The owner delegated the admin component library choice. The admin adds
`@radix-ui/react-dropdown-menu`, an unstyled primitive, for the account menu: arrow-key
navigation, typeahead, focus return and Escape come with it, and rewriting them is where
accessibility bugs live. Modals stay on the browser's native `<dialog>`. All styling stays ours,
from `@runsphere/ui` CSS variables.

Still excluded: Tailwind and shadcn/ui. Tailwind would add a second styling system beside the
tokens, and shadcn has no React Native counterpart, so it could not unify the two apps. Mobile
keeps its own React Native kit.
