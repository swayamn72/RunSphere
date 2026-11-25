import { View } from 'react-native';
import { NavigationIcon } from './NavigationIcon';

/**
 * Back and forward arrows drawn from the same icon set and stroke as the tab
 * bar, so they match at every size instead of depending on a font glyph.
 */
export function Chevron({
  direction,
  color,
  size = 20
}: {
  direction: 'back' | 'forward';
  color: string;
  size?: number;
}) {
  const icon = <NavigationIcon name="chevron" color={color} size={size} />;
  return direction === 'forward' ? (
    icon
  ) : (
    <View style={{ transform: [{ rotate: '180deg' }] }}>{icon}</View>
  );
}
