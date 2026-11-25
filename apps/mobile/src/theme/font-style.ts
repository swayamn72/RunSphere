import { interFamilyByWeight } from './type-style';

type StyleLike = unknown;

/** Merges nested style arrays the way React Native does, without needing React Native. */
export const flattenStyle = (style: StyleLike): Record<string, unknown> => {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return typeof style === 'object' ? (style as Record<string, unknown>) : {};
};

const familyForWeight = (weight: unknown): string => {
  const value = typeof weight === 'string' || typeof weight === 'number' ? String(weight) : '400';
  if (value === 'bold' || value === 'bolder') return interFamilyByWeight.bold;
  const number = Number(value);
  if (!Number.isFinite(number)) return interFamilyByWeight.regular;
  if (number >= 700) return interFamilyByWeight.bold;
  if (number >= 600) return interFamilyByWeight.semibold;
  if (number >= 500) return interFamilyByWeight.medium;
  return interFamilyByWeight.regular;
};

/**
 * The style to draw with once Inter is loaded: the family follows the weight
 * (Android ignores `fontWeight` for a custom family), and the weight is dropped
 * so a bold file is not synthesised bolder. A style that already names a family
 * is left alone. Returns the original style untouched when Inter isn't ready.
 */
export const withInter = (style: StyleLike, ready: boolean): StyleLike => {
  if (!ready) return style;
  const flat = flattenStyle(style);
  if (typeof flat.fontFamily === 'string') return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: familyForWeight(fontWeight) };
};
