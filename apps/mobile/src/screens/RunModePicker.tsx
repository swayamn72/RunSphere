import { Pressable, Text, View } from 'react-native';
import { useAppStyles } from '../components/styles';
import { NavigationIcon } from '../components/NavigationIcon';
import { useAppTheme } from '../theme/theme';
import { RUN_MODE_CARDS, type LaunchRunMode } from './run-mode-model';

const modeIcons = { free: 'run', turf: 'loop', quest: 'flag' } as const;

/**
 * Pick the kind of run before it starts (M9 9.6). The cards are large and one
 * line each, because this is read standing at a start line with a phone in
 * one hand. What each pick leads to is `pickRunMode`'s decision, not this
 * screen's.
 */
export function RunModePicker({
  onPick,
  onBrowseRoutes
}: {
  onPick: (mode: LaunchRunMode) => void;
  onBrowseRoutes?: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <View>
      <Text accessibilityRole="header" style={styles.screenTitle}>
        Pick your run
      </Text>
      <Text style={styles.lead}>Each one counts in its own way. You can’t switch mid-run.</Text>
      {RUN_MODE_CARDS.map((card) => (
        <Pressable
          key={card.mode}
          accessibilityRole="button"
          accessibilityLabel={`${card.title}. ${card.line}`}
          onPress={() => onPick(card.mode)}
          style={({ pressed }) => [styles.card, styles.cardRow, pressed && styles.buttonPressed]}
        >
          <NavigationIcon name={modeIcons[card.mode]} color={tokens.text.secondary} />
          <View style={styles.flexCopy}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.rowDetail}>{card.line}</Text>
          </View>
        </Pressable>
      ))}
      {onBrowseRoutes && (
        <Pressable
          accessibilityRole="button"
          onPress={onBrowseRoutes}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>Browse running routes</Text>
        </Pressable>
      )}
    </View>
  );
}
