import { View, type DimensionValue } from 'react-native';
import { radius } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';

export function Skeleton({
  width = '100%',
  height,
  round = false
}: {
  width?: DimensionValue;
  height: number;
  round?: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View
      importantForAccessibility="no"
      style={{
        width,
        height,
        borderRadius: round ? height / 2 : radius.control,
        backgroundColor: tokens.border.subtle
      }}
    />
  );
}
