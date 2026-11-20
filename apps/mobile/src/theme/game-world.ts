/**
 * The Turf game-world palette: the Midnight Navy basemap, the full-screen HUD,
 * the start-run orb and the map's game markers. It sits beside the core theme
 * rather than inside `@runsphere/ui`, because only the Turf map and the tab
 * bar use it, and a single named list keeps the no-hex guard in
 * `theme.test.ts` meaningful. The HUD text pairs are checked for AA contrast
 * there too.
 */
export const gameWorld = {
  map: {
    night: '#090f25',
    water: '#142f53',
    park: '#123132',
    roadCasing: '#263661',
    road: '#516a9c',
    label: '#d1e2f7',
    fog: '#040917'
  },
  loop: { ready: '#53ffab', returning: '#f8c969' },
  hud: {
    glass: '#0b1426ee',
    sheet: '#101a2df5',
    edge: '#355275',
    edgeSoft: '#3d587a',
    text: '#f0f7ff',
    textSoft: '#bfd1e8',
    detail: '#a8c4e8',
    tool: '#e5f1ff',
    status: '#d3e5fb',
    track: '#304967',
    progress: '#74eac6',
    avatar: '#14253b'
  },
  orb: {
    fill: '#6fffc6',
    rim: '#c5ffe8',
    glow: '#47ffbf',
    ink: '#063022'
  },
  player: {
    radar: '#31eaff24',
    radarRing: '#66f1ff',
    core: '#0b203d',
    coreRing: '#b9faff',
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
    shield: '#27233e',
    shieldRim: '#ffbf58',
    revenge: '#9d1d46',
    revengeRim: '#ff6387',
    text: '#fff5f8'
  },
  action: {
    ghost: '#e94977',
    ghostText: '#140b1d',
    lineage: '#213454',
    lineageRim: '#55779d'
  }
} as const;
