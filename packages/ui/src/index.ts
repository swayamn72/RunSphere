import { renderThemeCss, scaleToCssVariables, toCssVariables } from './css.js';

/**
 * RunSphere's semantic visual system. Screens consume these roles rather than
 * deriving colors from a palette or inverting a scheme at runtime.
 *
 * Charcoal surfaces, lime actions, and warm paper for reading.
 */
export interface SemanticTokens {
  readonly background: {
    readonly canvas: string;
    readonly surface: string;
    readonly surfaceRaised: string;
    readonly surfaceInset: string;
    /** The warm-paper card. Plain white on light; the approved paper on dark. */
    readonly paper: string;
  };
  readonly text: {
    readonly primary: string;
    readonly secondary: string;
    readonly inverse: string;
    readonly disabled: string;
    readonly tertiary: string;
    readonly onAccent: string;
    /**
     * Accent as *text* (links, eyebrows, selected labels). Lime on dark, deep
     * olive on light: lime is 1.14:1 on the light canvas, so it is only ever a
     * fill there (ADR-0016).
     */
    readonly accent: string;
    /** Ink on an `action.selected` / `brand.lime` fill, in both themes. */
    readonly onSelected: string;
    /** Ink and muted ink on `background.paper`, the approved warm-paper cards. */
    readonly onPaper: string;
    readonly onPaperMuted: string;
    /**
     * Rose for *text* (errors, destructive labels, rival headings). The brand
     * rose `#F43F5E` stays for zones, lines and fills, but as text it is
     * below AA on raised cards, but this shade passes on every
     * surface.
     */
    readonly danger: string;
  };
  readonly border: {
    readonly subtle: string;
    readonly strong: string;
    readonly focus: string;
    /** Lines inside a paper card. */
    readonly paper: string;
  };
  /** Brand fills. Never text on a light surface; see `text.accent`. */
  readonly brand: { readonly lime: string };
  readonly action: {
    readonly primary: string;
    readonly primaryPressed: string;
    readonly secondary: string;
    readonly selected: string;
    readonly disabled: string;
    /**
     * A filled destructive surface. Deliberately deeper than `status.error`:
     * this one carries white text, that one is text on a dark surface, and a
     * single red cannot clear 4.5:1 in both directions.
     */
    readonly danger: string;
    readonly dangerPressed: string;
  };
  readonly status: {
    readonly info: string;
    readonly success: string;
    readonly warning: string;
    readonly error: string;
    readonly pending: string;
  };
  /** Named hues for badges, tiers, and zone ownership. */
  readonly accent: {
    readonly violet: string;
    readonly amber: string;
    readonly coral: string;
    readonly azure: string;
    readonly gold: string;
  };
  /** Ownership colors for map polygons and the chips that stand in for them. */
  readonly zone: {
    readonly owned: string;
    readonly ownedFill: string;
    readonly rival: string;
    readonly rivalFill: string;
    readonly neutral: string;
    readonly neutralFill: string;
  };
  readonly route: { readonly line: string; readonly fill: string; readonly water: string };
  readonly checkpoint: { readonly fill: string; readonly text: string; readonly outline: string };
  readonly map: { readonly control: string; readonly controlText: string; readonly scrim: string };
  readonly scrim: { readonly subtle: string; readonly strong: string };
  readonly mascot: {
    readonly body: string;
    readonly outline: string;
    readonly orbit: string;
    readonly pointer: string;
    readonly eye: string;
    readonly beacon: string;
  };
}

export const appPalette = {
  canvas: '#101010',
  panel: '#1B1B1B',
  raised: '#252525',
  border: '#404040',
  mapLine: '#626262',
  accent: '#C9F44A',
  paper: '#F4F2ED',
  paperLine: '#D5D2CB',
  ink: '#101010',
  mutedInk: '#474541'
} as const;

export const darkTokens: SemanticTokens = {
  background: {
    canvas: appPalette.canvas,
    surface: appPalette.panel,
    surfaceRaised: appPalette.raised,
    surfaceInset: '#151515',
    paper: appPalette.paper
  },
  text: {
    primary: appPalette.paper,
    secondary: '#B8B5AE',
    inverse: appPalette.canvas,
    disabled: '#77746E',
    tertiary: '#9E9A93',
    onAccent: appPalette.canvas,
    accent: appPalette.accent,
    onSelected: appPalette.canvas,
    onPaper: appPalette.ink,
    onPaperMuted: appPalette.mutedInk,
    danger: '#FA6078'
  },
  border: {
    subtle: appPalette.border,
    strong: '#72706B',
    focus: appPalette.accent,
    paper: appPalette.paperLine
  },
  brand: { lime: appPalette.accent },
  action: {
    primary: appPalette.accent,
    primaryPressed: '#B4DA38',
    secondary: appPalette.raised,
    selected: appPalette.accent,
    disabled: '#363533',
    danger: '#BE123C',
    dangerPressed: '#9F1239'
  },
  status: {
    info: '#00E5FF',
    success: '#5BD08F',
    warning: '#F59E0B',
    error: '#F43F5E',
    pending: '#F59E0B'
  },
  accent: {
    violet: '#A78BFA',
    amber: '#F59E0B',
    coral: '#F43F5E',
    azure: '#00E5FF',
    gold: '#FFC861'
  },
  zone: {
    owned: appPalette.accent,
    ownedFill: '#C9F44A2E',
    rival: '#F43F5E',
    rivalFill: '#F43F5E2E',
    neutral: '#F59E0B',
    neutralFill: '#F59E0B2E'
  },
  route: { line: appPalette.accent, fill: '#C9F44A33', water: '#202527' },
  checkpoint: { fill: appPalette.accent, text: appPalette.canvas, outline: appPalette.paper },
  map: { control: appPalette.panel, controlText: appPalette.paper, scrim: '#101010E8' },
  scrim: { subtle: '#10101066', strong: '#101010D9' },
  mascot: {
    body: appPalette.raised,
    outline: '#77746E',
    orbit: appPalette.accent,
    pointer: appPalette.accent,
    eye: appPalette.paper,
    beacon: appPalette.accent
  }
};

/**
 * The default appearance (ADR-0016). Primary actions are near-black with paper
 * text; lime marks what is yours or selected and always carries ink. Map-drawn
 * roles (zone, route, checkpoint, map, mascot) are shared with dark on purpose:
 * the Turf map and the live run stay dark in both themes.
 */
export const lightTokens: SemanticTokens = {
  background: {
    canvas: appPalette.paper,
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceInset: '#EFECE6',
    paper: '#FFFFFF'
  },
  text: {
    primary: '#141414',
    secondary: '#4A4843',
    inverse: appPalette.paper,
    disabled: '#9C9891',
    tertiary: '#5F5C56',
    onAccent: appPalette.paper,
    accent: '#3F5A00',
    onSelected: '#141414',
    onPaper: '#141414',
    onPaperMuted: '#4A4843',
    danger: '#B4233C'
  },
  border: { subtle: '#E2DED6', strong: '#86827A', focus: '#3F5A00', paper: '#E2DED6' },
  brand: { lime: appPalette.accent },
  action: {
    primary: '#141414',
    primaryPressed: '#2B2B2B',
    secondary: '#FFFFFF',
    selected: appPalette.accent,
    disabled: '#E2DED6',
    danger: '#B4233C',
    dangerPressed: '#951C31'
  },
  status: {
    info: '#0B6E99',
    success: '#1A6E44',
    warning: '#9A5B00',
    error: '#B4233C',
    pending: '#9A5B00'
  },
  accent: {
    violet: '#6D4BD8',
    amber: '#9A5B00',
    coral: '#B4233C',
    azure: '#0B6E99',
    gold: '#8A6400'
  },
  zone: darkTokens.zone,
  route: darkTokens.route,
  checkpoint: darkTokens.checkpoint,
  map: darkTokens.map,
  scrim: { subtle: '#14141433', strong: '#141414B3' },
  mascot: darkTokens.mascot
};

export const semanticTokens = { light: lightTokens, dark: darkTokens } as const;

export type ColorSchemeName = keyof typeof semanticTokens;

/**
 * One colour per *other* holder, used where several past owners appear
 * together (a claim's ownership history). Deterministic per account so a rival
 * is the same colour on every screen. Kept here, not in a screen, so every
 * colour the app draws comes from this package. Your own ground always uses
 * `zone.owned`, which is deliberately not in this list.
 */
export const ownerPalette = [
  '#A855F7',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#10B981'
] as const;

/** Named AA-critical foreground/background pairs for automated contrast checks. */
export const contrastPairs = {
  primaryText: {
    foreground: darkTokens.text.primary,
    background: darkTokens.background.canvas,
    minimum: 4.5
  },
  secondaryText: {
    foreground: darkTokens.text.secondary,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  raisedSecondaryText: {
    foreground: darkTokens.text.secondary,
    background: darkTokens.background.surfaceRaised,
    minimum: 4.5
  },
  action: {
    foreground: darkTokens.text.onAccent,
    background: darkTokens.action.primary,
    minimum: 4.5
  },
  danger: {
    foreground: darkTokens.text.primary,
    background: darkTokens.action.danger,
    minimum: 4.5
  },
  raceGhost: {
    foreground: darkTokens.text.onAccent,
    background: darkTokens.zone.rival,
    minimum: 4.5
  },
  season: {
    foreground: darkTokens.zone.owned,
    background: darkTokens.background.canvas,
    minimum: 4.5
  },
  tertiaryTab: {
    foreground: darkTokens.text.tertiary,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  accentOnSurface: {
    foreground: darkTokens.action.primary,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  warningOnSurface: {
    foreground: darkTokens.status.warning,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  errorOnSurface: {
    foreground: darkTokens.status.error,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  violetOnSurface: {
    foreground: darkTokens.accent.violet,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  goldOnSurface: {
    foreground: darkTokens.accent.gold,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  progress: {
    foreground: darkTokens.checkpoint.text,
    background: darkTokens.checkpoint.fill,
    minimum: 3
  }
} as const;

/** WCAG 2.x contrast ratio between two `#RRGGBB` colours. */
export const contrastRatio = (foreground: string, background: string): number => {
  const luminance = (hex: string): number => {
    const [red = 0, green = 0, blue = 0] = [1, 3, 5]
      .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [light = 0, dark = 0] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Named foreground/background pairs for one scheme. `contrastPairs` stays the
 * dark set so existing imports keep working; the shared test runs both.
 */
export const contrastPairsFor = (t: SemanticTokens) =>
  ({
    primaryText: { foreground: t.text.primary, background: t.background.canvas, minimum: 4.5 },
    secondaryText: { foreground: t.text.secondary, background: t.background.surface, minimum: 4.5 },
    onPrimaryAction: { foreground: t.text.onAccent, background: t.action.primary, minimum: 4.5 },
    onSelected: { foreground: t.text.onSelected, background: t.action.selected, minimum: 4.5 },
    onPaper: { foreground: t.text.onPaper, background: t.background.paper, minimum: 4.5 },
    onPaperMuted: { foreground: t.text.onPaperMuted, background: t.background.paper, minimum: 4.5 },
    onDanger: { foreground: '#FFFFFF', background: t.action.danger, minimum: 4.5 },
    accentText: { foreground: t.text.accent, background: t.background.surface, minimum: 4.5 }
  }) as const;

/** Corner scale. Cards are modestly rounded; controls and chips are tighter; pills stay pills. */
export const radius = {
  sm: 6,
  chip: 8,
  control: 12,
  card: 16,
  sheet: 24,
  pill: 999
} as const;

/** Spacing scale used by screen padding and card gutters. The screen gutter is `lg`. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

/** Four weights only. 800 and 900 are retired (ADR-0016). */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700'
} as const;
export type FontWeightName = keyof typeof fontWeight;

/** The one typeface in both apps; `system` is the fallback when it hasn't loaded. */
export const fontFamily = {
  sans: 'Inter',
  system: 'system-ui'
} as const;

export interface TypeRole {
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: FontWeightName;
  readonly letterSpacing: number;
  /** Equal-width digits, for anything that changes while you read it. */
  readonly tabular?: boolean;
  readonly uppercase?: boolean;
}

export const typeScale = {
  liveMetric: { size: 56, lineHeight: 60, weight: 'bold', letterSpacing: -1, tabular: true },
  display: { size: 40, lineHeight: 44, weight: 'bold', letterSpacing: -0.8, tabular: true },
  title: { size: 28, lineHeight: 34, weight: 'bold', letterSpacing: -0.4 },
  metric: { size: 24, lineHeight: 28, weight: 'semibold', letterSpacing: -0.3, tabular: true },
  heading: { size: 20, lineHeight: 26, weight: 'semibold', letterSpacing: -0.2 },
  subheading: { size: 17, lineHeight: 22, weight: 'semibold', letterSpacing: 0 },
  body: { size: 15, lineHeight: 22, weight: 'regular', letterSpacing: 0 },
  bodyStrong: { size: 15, lineHeight: 22, weight: 'semibold', letterSpacing: 0 },
  label: { size: 13, lineHeight: 18, weight: 'medium', letterSpacing: 0.1 },
  caption: { size: 12, lineHeight: 16, weight: 'regular', letterSpacing: 0.1 },
  overline: {
    size: 11,
    lineHeight: 14,
    weight: 'semibold',
    letterSpacing: 0.8,
    uppercase: true
  }
} as const satisfies Record<string, TypeRole>;
export type TypeRoleName = keyof typeof typeScale;

/**
 * Light-theme shadows. Dark separates by surface step instead, so it uses none.
 * `elevation` is the Android equivalent.
 */
export const elevation = {
  shadowColor: '#141414',
  e1: { offsetY: 1, blur: 2, opacity: 0.06, elevation: 1 },
  e2: { offsetY: 4, blur: 12, opacity: 0.1, elevation: 4 },
  e3: { offsetY: 12, blur: 32, opacity: 0.16, elevation: 12 }
} as const;

/** Durations in ms. Honour reduce-motion before using them. */
export const motion = { fast: 120, base: 200, slow: 320 } as const;

/** Web layout. */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export const layout = { contentMaxWidth: 1200, sidebarWidth: 240 } as const;

export { toCssVariables, scaleToCssVariables, renderThemeCss } from './css.js';

/** Everything the web needs as one stylesheet. Light is the default. */
export const buildThemeCss = (): string =>
  renderThemeCss({
    scales: scaleToCssVariables({
      space,
      radius,
      motion,
      typeScale,
      fontWeight,
      fontFamily,
      elevation
    }),
    light: toCssVariables(lightTokens),
    dark: toCssVariables(darkTokens)
  });
