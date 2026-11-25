import type { SemanticTokens } from './index.js';

const kebab = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * Flattens one scheme's semantic roles into CSS custom properties:
 * `text.onPaper` becomes `--rs-text-on-paper`. Pure, so the admin and its tests
 * share one mapping and no stylesheet carries a colour of its own.
 */
export const toCssVariables = (tokens: SemanticTokens): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [group, roles] of Object.entries(tokens))
    for (const [role, value] of Object.entries(roles as Record<string, string>))
      out[`--rs-${kebab(group)}-${kebab(role)}`] = value;
  return out;
};

const px = (value: number): string => `${value}px`;

/** Scheme-independent scales as CSS custom properties. */
export const scaleToCssVariables = (scales: {
  space: Record<string, number>;
  radius: Record<string, number>;
  motion: Record<string, number>;
  typeScale: Record<
    string,
    {
      size: number;
      lineHeight: number;
      weight: string;
      letterSpacing: number;
      tabular?: boolean;
      uppercase?: boolean;
    }
  >;
  fontWeight: Record<string, string>;
  fontFamily: { sans: string; system: string };
  elevation: Record<string, { offsetY: number; blur: number; opacity: number } | string>;
}): Record<string, string> => {
  const out: Record<string, string> = {
    '--rs-font-sans': `${scales.fontFamily.sans}, ${scales.fontFamily.system}, ui-sans-serif, sans-serif`
  };
  for (const [key, value] of Object.entries(scales.space))
    out[`--rs-space-${kebab(key)}`] = px(value);
  for (const [key, value] of Object.entries(scales.radius))
    out[`--rs-radius-${kebab(key)}`] = px(value);
  for (const [key, value] of Object.entries(scales.motion))
    out[`--rs-motion-${kebab(key)}`] = `${value}ms`;
  for (const [key, value] of Object.entries(scales.fontWeight))
    out[`--rs-weight-${kebab(key)}`] = value;
  for (const [key, role] of Object.entries(scales.typeScale)) {
    const name = `--rs-type-${kebab(key)}`;
    out[`${name}-size`] = px(role.size);
    out[`${name}-line`] = px(role.lineHeight);
    out[`${name}-weight`] = scales.fontWeight[role.weight] ?? '400';
    out[`${name}-tracking`] = `${role.letterSpacing}px`;
  }
  const { shadowColor } = scales.elevation;
  for (const [key, value] of Object.entries(scales.elevation)) {
    if (typeof value === 'string') continue;
    // Shadow opacity is applied with color-mix so the colour stays a token.
    out[`--rs-shadow-${kebab(key)}`] =
      `0 ${px(value.offsetY)} ${px(value.blur)} color-mix(in srgb, ${String(shadowColor)} ${Math.round(value.opacity * 100)}%, transparent)`;
  }
  return out;
};

const block = (selector: string, vars: Record<string, string>): string =>
  `${selector}{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')}}`;

/**
 * The full theme sheet: scales on `:root`, each scheme under `[data-theme]`.
 * Dark drops shadows, which it replaces with surface steps.
 */
export const renderThemeCss = (input: {
  scales: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
}): string =>
  [
    block(':root', input.scales),
    block(':root,:root[data-theme="light"]', { ...input.light, 'color-scheme': 'light' }),
    block(':root[data-theme="dark"]', {
      ...input.dark,
      '--rs-shadow-e1': 'none',
      '--rs-shadow-e2': 'none',
      '--rs-shadow-e3': 'none',
      'color-scheme': 'dark'
    })
  ].join('\n');
