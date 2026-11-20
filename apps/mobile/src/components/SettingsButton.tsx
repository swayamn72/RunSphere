import { Pressable, Text, View } from 'react-native';
import { useAppStyles } from './styles';

export function SettingsButton({ onPress }: { onPress: () => void }) {
  const styles = useAppStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={2}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View style={[styles.headerButton, pressed && styles.buttonPressed]}>
          <Text style={styles.headerButtonGlyph}>{'\u2699'}</Text>
        </View>
      )}
    </Pressable>
  );
}
