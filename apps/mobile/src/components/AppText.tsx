import type React from 'react';
import { Text, type TextProps } from 'react-native';
import type { SemanticTokens, TypeRoleName } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';
import { textStyleFor } from '../theme/type-style';

/** The text colours a screen may ask for by name. */
export type TextTone = keyof SemanticTokens['text'];

export interface AppTextProps extends TextProps {
  /** Size, weight and spacing come from the shared type scale. */
  variant?: TypeRoleName;
  tone?: TextTone;
  /** Equal-width digits. Roles for numbers already set this; pass it for a stat in body text. */
  tabular?: boolean;
  children?: React.ReactNode;
}

/**
 * The one way to set text. Screens name a role and a tone instead of choosing a
 * size and weight, so the scale stays small and the typeface stays Inter.
 */
export function AppText({
  variant = 'body',
  tone = 'primary',
  tabular,
  style,
  ...props
}: AppTextProps) {
  const { tokens, fontsReady } = useAppTheme();
  return (
    <Text
      {...props}
      style={[textStyleFor(variant, { fontsReady, tabular }), { color: tokens.text[tone] }, style]}
    />
  );
}
