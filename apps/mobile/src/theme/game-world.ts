import { appPalette } from '@runsphere/ui';

/**
 * The Turf game-world palette: the dark basemap, the full-screen HUD,
 * the start-run orb and the map's game markers. It sits beside the core theme
 * rather than inside `@runsphere/ui`. A single named list keeps the no-hex guard in
 * `theme.test.ts` meaningful. The HUD text pairs are checked for AA contrast
 * there too.
 */
export const gameWorld = {
  map: {
    night: '#101010',
    water: '#22292c',
    park: '#272d22',
    roadCasing: '#353535',
    road: '#686868',
    label: '#e7e3db',
    fog: '#0a0a0a'
  },
  loop: { ready: appPalette.accent, returning: '#f8c969' },
  /**
   * A run drawn on its detail map (M9 9.18): coloured from the run's own
   * quickest stretch to its slowest, a glowing tip while it draws, and the
   * start and finish markers.
   */
  route: {
    quick: appPalette.accent,
    easy: '#f8c969',
    head: '#effabf',
    start: appPalette.accent,
    finish: '#f0f7ff',
    markerRim: '#101010'
  },
  hud: {
    glass: '#1b1b1bee',
    sheet: '#1b1b1bf5',
    edge: '#404040',
    edgeSoft: '#626262',
    text: '#f0f7ff',
    textSoft: '#d0ccc3',
    detail: '#c0bcb3',
    tool: '#f4f2ed',
    status: '#e7e3db',
    track: '#44433f',
    progress: appPalette.accent,
    avatar: '#252525'
  },
  orb: {
    fill: appPalette.accent,
    rim: '#effabf',
    glow: appPalette.accent,
    ink: '#101010'
  },
  player: {
    radar: '#c9f44a24',
    radarRing: '#c9f44a',
    core: '#252525',
    coreRing: appPalette.accent,
    arrow: '#62efff'
  },
  quest: {
    marker: '#ffe38c',
    markerEdge: '#362717',
    halo: '#ffca5833',
    rim: '#ffe596',
    core: '#4b351b'
  },
  badge: {
    crown: '#ffdb78',
    shield: '#252525',
    shieldRim: '#ffbf58',
    revenge: '#9d1d46',
    revengeRim: '#ff6387',
    text: '#fff5f8'
  },
  action: {
    ghost: '#e94977',
    ghostText: '#140b1d',
    lineage: '#252525',
    lineageRim: '#626262'
  }
} as const;
