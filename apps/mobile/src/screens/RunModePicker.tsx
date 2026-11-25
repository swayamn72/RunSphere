import { Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import { useAppStyles } from '../components/styles';
import { Chevron } from '../components/Chevron';
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
      {RUN_MODE_CARDS.map((card) => {
        // Free run is the default way to run, so it leads and is filled; the
        // other two are choices beside it.
        const lead = card.mode === 'free';
        const ink = lead ? tokens.text.onAccent : tokens.text.primary;
        return (
          <Pressable
            key={card.mode}
            accessibilityRole="button"
            accessibilityLabel={`${card.title}. ${card.line}`}
            onPress={() => onPick(card.mode)}
            style={({ pressed }) => [
              styles.card,
              styles.cardRow,
              lead && {
                backgroundColor: tokens.action.primary,
                borderColor: tokens.action.primary
              },
              pressed && styles.buttonPressed
            ]}
          >
            <NavigationIcon
              name={modeIcons[card.mode]}
              color={lead ? ink : tokens.text.secondary}
            />
            <View style={styles.flexCopy}>
              <Text style={[styles.cardTitle, lead && { color: ink }]}>{card.title}</Text>
              <Text style={[styles.rowDetail, lead && { color: ink }]}>{card.line}</Text>
            </View>
            <Chevron direction="forward" size={18} color={lead ? ink : tokens.text.secondary} />
          </Pressable>
        );
      })}
      {onBrowseRoutes && (
        <Pressable
          accessibilityRole="button"
          onPress={onBrowseRoutes}
          style={({ pressed }) => [styles.card, styles.cardRow, pressed && styles.buttonPressed]}
        >
          <NavigationIcon name="route" color={tokens.text.secondary} />
          <View style={styles.flexCopy}>
            <Text style={styles.cardTitle}>Browse running routes</Text>
          </View>
          <Chevron direction="forward" size={18} color={tokens.text.secondary} />
        </Pressable>
      )}
    </View>
  );
}
