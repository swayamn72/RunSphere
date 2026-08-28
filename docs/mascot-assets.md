# Loop mascot assets

## Provenance and ownership

Loop is an original RunSphere character created for this repository on 2026-08-28. It is built from an asymmetric trail-body, orbital path, north pointer, two eyes, and beacon node. It does not reproduce, trace, or incorporate any stock mascot, character, third-party illustration, font glyph, or AI-generated asset. RunSphere owns the source geometry and exports in this directory.

## Source and exports

- Editable vector sources and usable exports: `apps/mobile/assets/mascot/loop-<variant>-<theme>.svg`
- Variants: `home`, `loading`, `empty`, `gps-recovery`, `offline`, and `pending`. They are named, state-scoped export selections of one static Loop pose; no behavioural or celebratory pose is implied by a filename.
- Themes: `dark`, `light`
- Editable construction sources: `apps/mobile/assets/mascot/source/loop-construction-<theme>.svg`; state exports are maintained alongside them in `apps/mobile/assets/mascot/`.
- Native rendering: `apps/mobile/src/components/Mascot.tsx` renders the documented Loop geometry with semantic theme tokens, avoiding a native SVG dependency. It is static in every mode.
- Tools: authored as hand-written SVG/XML. No external fonts or art tools are required.

## Usage boundaries

Loop is a restrained guide. Use one state-specific instance at a time for Home, loading/empty, GPS recovery, offline, or pending processing guidance. A meaningful instance must use concise non-duplicative accessibility text; decorative instances must be hidden from accessibility. Keep the static version when reduced motion is enabled.

Do not place Loop on a map canvas or use it as a person/location marker. It must not claim that an activity or checkpoint is valid, announce a reward, rank a person, celebrate territory/XP, represent another runner, diagnose cheating, pressure consent, or celebrate a rejected activity. Rejected states use neutral support copy without Loop.

## Crew mascots (Rho, Mira, Coda, Bram)

The four crew movers extend Loop's visual language without giving Loop the authority, reward, or rejection signals it is forbidden from carrying. Each is an app-owned, hand-authored vector character. The storyline, character roles, style anchor, and generation prompts live in [`mascot-storyline.md`](mascot-storyline.md).

- Editable vector sources and exports: `apps/mobile/assets/mascot/crew/crew-<character>-<theme>.svg`, one static pose per character.
- Characters: `rho`, `mira`, `coda`, `bram`. Themes: `dark`, `light`.
- Runtime rendering: `apps/mobile/src/components/CrewMascot.tsx` renders a dependency-free vector stand-in using the same `tokens.mascot` roles as Loop. It is static in every mode and does not import a native SVG runtime.
- Character registry and guardrail: `apps/mobile/src/crew.ts` lists the crew and reuses Loop's safe-label rule (`isSafeMascotLabel`), so crew labels may not claim authority, rewards, or rejection.

### Swapping crew vector art for user-provided images

Artwork replacement is a one-file change via `apps/mobile/src/crew-assets.ts`:

1. Drop a PNG alongside the SVG at `apps/mobile/assets/mascot/crew/`. Expected filenames: `crew-<character>-light.png` and `crew-<character>-dark.png`.
2. Wire the `require(...)` for that character into `crewImageOverrides` (light and dark).
3. `CrewMascot` then prefers the active theme's image automatically; characters left out of the map keep the built-in vector fallback.

Recommended raster size is 224-512 px square with transparent padding, exported at 2-3x so the 76 px on-screen render stays crisp.
