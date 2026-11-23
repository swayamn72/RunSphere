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
  };
  readonly text: {
    readonly primary: string;
    readonly secondary: string;
    readonly inverse: string;
    readonly disabled: string;
    readonly tertiary: string;
    readonly onAccent: string;
    /**
     * Rose for *text* (errors, destructive labels, rival headings). The brand
     * rose `#F43F5E` stays for zones, lines and fills, but as text it is
     * below AA on raised cards, but this shade passes on every
     * surface.
     */
    readonly danger: string;
  };
  readonly border: { readonly subtle: string; readonly strong: string; readonly focus: string };
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
    surfaceInset: '#151515'
  },
  text: {
    primary: appPalette.paper,
    secondary: '#B8B5AE',
    inverse: appPalette.canvas,
    disabled: '#77746E',
    tertiary: '#B8B5AE',
    onAccent: appPalette.canvas,
    danger: '#FA6078'
  },
  border: { subtle: appPalette.border, strong: '#72706B', focus: appPalette.accent },
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
    success: appPalette.accent,
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

export const semanticTokens = { dark: darkTokens } as const;

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

/** Corner scale. Cards are generously rounded; controls are pills. */
export const radius = { card: 24, control: 18, chip: 14, pill: 999 } as const;

/** Spacing scale used by screen padding and card gutters. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
