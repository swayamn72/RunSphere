import {
  fontFamily,
  fontWeight,
  typeScale,
  type FontWeightName,
  type TypeRoleName
} from '@runsphere/ui';

/**
 * Inter's four static files, by the family name each is registered under.
 * Android ignores `fontWeight` for a custom family, so the weight has to pick
 * the file; that is why weights map to family names rather than to a style.
 */
export const interFamilyByWeight: Record<FontWeightName, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold'
};

export interface TextStyleResult {
  fontFamily?: string;
  fontWeight?: '400' | '500' | '600' | '700';
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontVariant?: ['tabular-nums'];
  textTransform?: 'uppercase';
}

/**
 * The React Native style for a type role. With Inter loaded the weight is
 * carried by the family; without it (loading failed) it falls back to the
 * platform font and a numeric weight, so text is still readable and still bold
 * where it should be.
 */
export const textStyleFor = (
  role: TypeRoleName,
  options: { fontsReady: boolean; tabular?: boolean | undefined } = { fontsReady: false }
): TextStyleResult => {
  const spec = typeScale[role] as {
    size: number;
    lineHeight: number;
    weight: FontWeightName;
    letterSpacing: number;
    tabular?: boolean;
    uppercase?: boolean;
  };
  const style: TextStyleResult = {
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing
  };
  if (options.fontsReady) style.fontFamily = interFamilyByWeight[spec.weight];
  else style.fontWeight = fontWeight[spec.weight];
  if (options.tabular ?? spec.tabular) style.fontVariant = ['tabular-nums'];
  if (spec.uppercase) style.textTransform = 'uppercase';
  return style;
};

export const sansFamily = fontFamily.sans;
