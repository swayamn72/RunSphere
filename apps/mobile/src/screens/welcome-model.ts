import type { IconName } from '../components/lucide-icons';

/**
 * What the first screen says and draws. Every line is something the app does
 * today (loops claim ground, friend standings, privacy zones), per voice rule 7.
 */
export const WELCOME_COPY = {
  brand: 'TURFR',
  headline: 'Run a loop.\nClaim your ground.',
  primary: 'Get started',
  secondary: 'I already have an account'
} as const;

export const WELCOME_FEATURES: readonly { icon: IconName; title: string; line: string }[] = [
  {
    icon: 'land-plot',
    title: 'Claim real streets',
    line: 'Close a loop and the ground inside is yours.'
  },
  {
    icon: 'users',
    title: 'Run with friends',
    line: 'See where you all stand each season.'
  },
  {
    icon: 'shield-check',
    title: 'Your privacy, your call',
    line: 'Privacy zones trim your routes near home.'
  }
];

/** The illustration's frame, in drawing units. */
export const TURF_ART = {
  width: 360,
  height: 260,
  centre: { x: 180, y: 130 },
  radius: 24
} as const;

export interface HexCell {
  key: string;
  path: string;
  claimed: boolean;
}

/**
 * A flat-topped hex grid with the middle cluster claimed. Purely decorative: it
 * stands for Turf and shows no real runner's ground.
 */
export const turfHexCells = (claimWithin = 58): HexCell[] => {
  const { centre, radius } = TURF_ART;
  const half = (Math.sqrt(3) * radius) / 2;
  const corner = [
    [radius, 0],
    [radius / 2, half],
    [-radius / 2, half],
    [-radius, 0],
    [-radius / 2, -half],
    [radius / 2, -half]
  ] as const;
  const cells: HexCell[] = [];
  for (let column = 0; column <= 10; column += 1)
    for (let row = -1; row <= 7; row += 1) {
      const x = column * radius * 1.5;
      const y = row * half * 2 + (column % 2) * half + 5.4;
      const path = `${corner
        .map(([dx, dy], i) => `${i ? 'L' : 'M'}${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`)
        .join(' ')}Z`;
      cells.push({
        key: `${column}:${row}`,
        path,
        claimed: Math.hypot(x - centre.x, y - centre.y) <= claimWithin
      });
    }
  return cells;
};

/** The run that closed the claim, drawn around the claimed cluster. */
export const TURF_LOOP =
  'M180 52C230 52 268 87 268 130C268 173 230 208 180 208C130 208 92 173 92 130C92 87 130 52 180 52Z';
export const TURF_LOOP_START = { x: 180, y: 52 } as const;
/** Streets under the grid, so the claim reads as ground and not as a pattern. */
export const TURF_STREETS =
  'M-10 70C60 78 110 40 190 20S300 0 370 18M-10 190C50 168 120 232 200 226S310 190 370 204M64 -10C72 60 40 130 66 270M296 -10C282 70 330 150 300 270M-10 120L96 132M264 128L370 112';
