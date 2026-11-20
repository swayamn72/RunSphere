/**
 * RunSphere's semantic visual system. Screens consume these roles rather than
 * deriving colors from a palette or inverting a scheme at runtime.
 *
 * Tactical Night uses dark slate surfaces and distinct accents for actions,
 * territory ownership, and run guidance.
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
    canvas: '#090D16',
    surface: '#111827',
    surfaceRaised: '#182235',
    surfaceInset: '#0D1320'
  },
  text: {
    primary: '#F8FAFC',
    secondary: '#94A3B8',
    inverse: '#090D16',
    disabled: '#64748B',
    tertiary: '#94A3B8',
    onAccent: '#090D16'
  },
  border: { subtle: '#1E293B', strong: '#475569', focus: '#00E5FF' },
  action: {
    primary: '#22C55E',
    primaryPressed: '#20B955',
    secondary: '#182235',
    selected: '#22C55E',
    disabled: '#253246',
    danger: '#BE123C',
    dangerPressed: '#9F1239'
  },
  status: {
    info: '#00E5FF',
    success: '#22C55E',
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
    owned: '#00E5FF',
    ownedFill: '#00E5FF2E',
    rival: '#F43F5E',
    rivalFill: '#F43F5E2E',
    neutral: '#F59E0B',
    neutralFill: '#F59E0B2E'
  },
  route: { line: '#00E5FF', fill: '#00E5FF33', water: '#13263D' },
  checkpoint: { fill: '#22C55E', text: '#090D16', outline: '#F8FAFC' },
  map: { control: '#111827', controlText: '#F8FAFC', scrim: '#090D16E8' },
  scrim: { subtle: '#090D1666', strong: '#090D16D9' },
  mascot: {
    body: '#182235',
    outline: '#64748B',
    orbit: '#00E5FF',
    pointer: '#00E5FF',
    eye: '#F8FAFC',
    beacon: '#00E5FF'
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
