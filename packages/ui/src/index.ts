/**
 * RunSphere's semantic visual system. Screens consume these roles rather than
 * deriving colors from a palette or inverting a scheme at runtime.
 *
 * The product ships one appearance: a near-black green canvas with a single
 * mint accent, plus a small set of named hues that carry meaning on the map
 * (owned turf, rival turf, neutral turf) and in the reward surfaces.
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

export const darkTokens: SemanticTokens = {
  background: {
    canvas: '#0B1A14',
    surface: '#14261E',
    surfaceRaised: '#1C3328',
    surfaceInset: '#102019'
  },
  text: {
    primary: '#F2F7F4',
    secondary: '#9DB3A8',
    inverse: '#04180E',
    disabled: '#657A70',
    tertiary: '#9DB3A8',
    onAccent: '#04180E'
  },
  border: { subtle: '#21362C', strong: '#3A564A', focus: '#3DDC7E' },
  action: {
    primary: '#3DDC7E',
    primaryPressed: '#32BC6B',
    secondary: '#1C3328',
    selected: '#3DDC7E',
    disabled: '#264034',
    danger: '#D93B2B',
    dangerPressed: '#B93123'
  },
  status: {
    info: '#5AA9FF',
    success: '#3DDC7E',
    warning: '#F2A33C',
    error: '#FF6B5A',
    pending: '#F2A33C'
  },
  accent: {
    violet: '#A78BFA',
    amber: '#F2A33C',
    coral: '#FF6B5A',
    azure: '#5AA9FF',
    gold: '#FFC861'
  },
  zone: {
    owned: '#3DDC7E',
    ownedFill: '#3DDC7E2E',
    rival: '#FF6B5A',
    rivalFill: '#FF6B5A2E',
    neutral: '#A78BFA',
    neutralFill: '#A78BFA2E'
  },
  route: { line: '#3DDC7E', fill: '#3DDC7E33', water: '#12303A' },
  checkpoint: { fill: '#3DDC7E', text: '#04180E', outline: '#F2F7F4' },
  map: { control: '#14261E', controlText: '#F2F7F4', scrim: '#0B1A14E8' },
  scrim: { subtle: '#04180E66', strong: '#04180ED9' },
  mascot: {
    body: '#1C3328',
    outline: '#4E7263',
    orbit: '#3DDC7E',
    pointer: '#5AA9FF',
    eye: '#F2F7F4',
    beacon: '#3DDC7E'
  }
};

export const semanticTokens = { dark: darkTokens } as const;

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
  danger: { foreground: '#FFFFFF', background: darkTokens.action.danger, minimum: 4.5 },
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
