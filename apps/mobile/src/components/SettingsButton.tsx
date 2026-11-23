import { Pressable, View } from 'react-native';
import { useAppStyles } from './styles';
import { NavigationIcon } from './NavigationIcon';
import { useAppTheme } from '../theme/theme';

export function SettingsButton({ onPress }: { onPress: () => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={2}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View style={[styles.headerButton, pressed && styles.buttonPressed]}>
          <NavigationIcon name="settings" color={tokens.text.primary} />
        </View>
      )}
    </Pressable>
  );
}
