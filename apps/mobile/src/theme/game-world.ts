import { appPalette } from '@runsphere/ui';

/**
 * The Turf game-world palette, night version: the dark basemap, the full-screen HUD,
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
    fog: '#0a0a0a',
    /** 3D buildings: a shade above the ground so blocks read without glare. */
    building: '#2a2a2a',
    /** Under claim outlines; on night ground the colour itself carries. */
    casing: '#000000'
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
    core: '#4b351b',
    /** A stop the live run has passed, and the number's ink on a stop. */
    passed: appPalette.accent,
    ink: '#101010'
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

type Palette<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: string } };
export type GameWorldPalette = Palette<typeof gameWorld>;

/**
 * The day version, for the light theme (ADR-0017). Same roles, so every map
 * surface reads one palette. What changes is the ground and the glass; the
 * badges, quest markers and ghost action are self-contained chips and keep
 * their night colours. Lime is a fill on paper, never a thin line (1.14:1), so
 * routes and loops use deep olive and amber-brown instead.
 */
export const gameWorldDay: GameWorldPalette = {
  map: {
    night: '#efede6',
    water: '#bfd6e0',
    park: '#d5e3c8',
    roadCasing: '#d2cec4',
    road: '#ffffff',
    label: '#2e2c28',
    fog: '#8a867c',
    building: '#dedad0',
    casing: '#1b1b1b'
  },
  loop: { ready: '#4b6b00', returning: '#a35f00' },
  route: {
    quick: '#3f5a00',
    easy: '#b26b00',
    head: '#5d8500',
    start: '#3f5a00',
    finish: '#1b1b1b',
    markerRim: '#ffffff'
  },
  hud: {
    glass: '#ffffffee',
    sheet: '#fffffff5',
    edge: '#d9d6ce',
    edgeSoft: '#bdb9b0',
    text: '#141414',
    textSoft: '#4a4740',
    detail: '#55524b',
    tool: '#1b1b1b',
    status: '#2f2d29',
    track: '#e2dfd8',
    progress: appPalette.accent,
    avatar: '#edeae3'
  },
  orb: gameWorld.orb,
  player: {
    radar: '#4b6b0024',
    radarRing: '#4b6b00',
    core: '#ffffff',
    coreRing: '#3f5a00',
    arrow: '#0369a1'
  },
  quest: gameWorld.quest,
  badge: gameWorld.badge,
  action: gameWorld.action
};

export const gameWorldFor = (scheme: 'light' | 'dark'): GameWorldPalette =>
  scheme === 'light' ? gameWorldDay : gameWorld;
