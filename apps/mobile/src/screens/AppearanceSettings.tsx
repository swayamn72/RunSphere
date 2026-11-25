import { Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import { useAppStyles } from '../components/styles';
import { SettingsGroup } from '../components/primitives';
import { useAppTheme } from '../theme/theme';
import { APPEARANCE_OPTIONS, appearanceHint } from './appearance-model';

/** Light, Dark or Match phone. Applies at once and is remembered on this device. */
export function AppearanceSettings() {
  const styles = useAppStyles();
  const { preference, setPreference } = useAppTheme();
  return (
    <SettingsGroup title="Appearance">
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.segmented}>
        {APPEARANCE_OPTIONS.map((option) => {
          const checked = option.value === preference;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked }}
              onPress={() => setPreference(option.value)}
              style={[styles.segment, checked && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, checked && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.rowDetail}>{appearanceHint(preference)}</Text>
    </SettingsGroup>
  );
}
