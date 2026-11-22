import { Pressable, Text, View } from 'react-native';
import type { RunMode } from '@runsphere/contracts';
import { useAppStyles } from '../components/styles';
import { RUN_MODE_CARDS } from './run-mode-model';

/**
 * Pick the kind of run before it starts (M9 9.6). The cards are large and one
 * line each, because this is read standing at a start line with a phone in
 * one hand. What each pick leads to is `pickRunMode`'s decision, not this
 * screen's.
 */
export function RunModePicker({ onPick }: { onPick: (mode: RunMode) => void }) {
  const styles = useAppStyles();
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
          style={styles.card}
        >
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.rowDetail}>{card.line}</Text>
        </Pressable>
      ))}
    </View>
  );
}
