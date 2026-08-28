/**
 * RunSphere's semantic visual system. Screens consume these roles rather than
 * deriving colors from a palette or inverting dark mode at runtime.
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
  };
  readonly status: {
    readonly info: string;
    readonly success: string;
    readonly warning: string;
    readonly error: string;
    readonly pending: string;
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
    canvas: '#071714',
    surface: '#0D231F',
    surfaceRaised: '#173A32',
    surfaceInset: '#122E28'
  },
  text: {
    primary: '#F5F7EF',
    secondary: '#B5C5BD',
    inverse: '#061411',
    disabled: '#80968D',
    tertiary: '#B5C5BD',
    onAccent: '#061411'
  },
  border: { subtle: '#315249', strong: '#557068', focus: '#C9F15A' },
  action: {
    primary: '#C9F15A',
    primaryPressed: '#B4DB49',
    secondary: '#173A32',
    selected: '#C9F15A',
    disabled: '#315249'
  },
  status: {
    info: '#6FC8DF',
    success: '#47D5BD',
    warning: '#FFC968',
    error: '#FF8E78',
    pending: '#FFC968'
  },
  route: { line: '#C9F15A', fill: '#C9F15A33', water: '#144655' },
  checkpoint: { fill: '#C9F15A', text: '#061411', outline: '#F5F7EF' },
  map: { control: '#0A1C19', controlText: '#F5F7EF', scrim: '#071714E8' },
  scrim: { subtle: '#06141166', strong: '#061411D9' },
  mascot: {
    body: '#21483E',
    outline: '#5B8075',
    orbit: '#C9F15A',
    pointer: '#47D5BD',
    eye: '#F7FFF7',
    beacon: '#C9F15A'
  }
};

/** Explicit system-light values; this is not a derived or inverted palette. */
export const lightTokens: SemanticTokens = {
  background: {
    canvas: '#F6F3E8',
    surface: '#FFFDF5',
    surfaceRaised: '#FFFFFF',
    surfaceInset: '#EAF0E8'
  },
  text: {
    primary: '#10251F',
    secondary: '#52645C',
    inverse: '#FFFFFF',
    disabled: '#718078',
    tertiary: '#52645C',
    onAccent: '#10251F'
  },
  border: { subtle: '#BDC9BF', strong: '#82948A', focus: '#087B69' },
  action: {
    primary: '#184F3D',
    primaryPressed: '#123D30',
    secondary: '#E1F0E5',
    selected: '#184F3D',
    disabled: '#C8D2CB'
  },
  status: {
    info: '#246D84',
    success: '#075F52',
    warning: '#8A5A00',
    error: '#A83E2B',
    pending: '#8A5A00'
  },
  route: { line: '#5D8500', fill: '#8FBD1844', water: '#4E91A5' },
  checkpoint: { fill: '#8FBD18', text: '#10251F', outline: '#FFFFFF' },
  map: { control: '#FFFFFF', controlText: '#10251F', scrim: '#F6F3E8EB' },
  scrim: { subtle: '#10251F33', strong: '#10251FCC' },
  mascot: {
    body: '#D9EAE0',
    outline: '#386755',
    orbit: '#5D8500',
    pointer: '#087B69',
    eye: '#10251F',
    beacon: '#8FBD18'
  }
};

export const semanticTokens = { dark: darkTokens, light: lightTokens } as const;

/** Named AA-critical foreground/background pairs for automated contrast checks. */
export const contrastPairs = {
  darkPrimaryText: {
    foreground: darkTokens.text.primary,
    background: darkTokens.background.canvas,
    minimum: 4.5
  },
  darkSecondaryText: {
    foreground: darkTokens.text.secondary,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  darkAction: {
    foreground: darkTokens.text.onAccent,
    background: darkTokens.action.primary,
    minimum: 4.5
  },
  darkTertiaryTab: {
    foreground: darkTokens.text.tertiary,
    background: darkTokens.background.surface,
    minimum: 4.5
  },
  lightPrimaryText: {
    foreground: lightTokens.text.primary,
    background: lightTokens.background.surface,
    minimum: 4.5
  },
  lightSecondaryText: {
    foreground: lightTokens.text.secondary,
    background: lightTokens.background.surface,
    minimum: 4.5
  },
  lightAction: {
    foreground: lightTokens.text.inverse,
    background: lightTokens.action.primary,
    minimum: 4.5
  },
  lightStatus: {
    foreground: lightTokens.status.success,
    background: lightTokens.action.secondary,
    minimum: 4.5
  },
  lightProgress: {
    foreground: lightTokens.checkpoint.text,
    background: lightTokens.checkpoint.fill,
    minimum: 3
  },
  lightTertiaryTab: {
    foreground: lightTokens.text.tertiary,
    background: lightTokens.background.surface,
    minimum: 4.5
  }
} as const;

/** Legacy aliases for existing surfaces while they migrate to semantic roles. */
export const colors = {
  ink: lightTokens.text.primary,
  muted: lightTokens.text.secondary,
  cream: lightTokens.background.canvas,
  card: lightTokens.background.surface,
  lime: '#8FBD18',
  moss: lightTokens.action.primary,
  teal: lightTokens.status.success,
  orange: lightTokens.status.warning,
  line: lightTokens.border.subtle,
  blue: lightTokens.route.water
} as const;

export const radius = { card: 20, control: 18, pill: 999 } as const;
