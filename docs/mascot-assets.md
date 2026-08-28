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
