import {
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps
} from 'react-native';
import { isInterReady } from '../theme/font-state';
import { withInter } from '../theme/font-style';

/**
 * Drop-in replacements for React Native's `Text` and `TextInput` that draw in
 * Inter (ADR-0016). A screen keeps writing `fontWeight`; the family that
 * carries that weight is picked here, so no screen names a font file. Until
 * Inter has loaded, or if it never does, they are exactly the native
 * components.
 */
export function Text(props: TextProps) {
  return (
    <NativeText {...props} style={withInter(props.style, isInterReady()) as TextProps['style']} />
  );
}

export function TextInput(props: TextInputProps) {
  return (
    <NativeTextInput
      {...props}
      style={withInter(props.style, isInterReady()) as TextInputProps['style']}
    />
  );
}
