import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppStyles } from '../components/styles';
import type { RunDetailSlotProps } from './RunDetailHost';
import { runCard } from './run-log-model';

/**
 * One run, opened from a run log (M9 9.16; layout grows in 9.19). The header
 * is the drag handle: pull it down, or press Back, to close.
 */
export function RunDetailScreen({ run, close, dragHandlers }: RunDetailSlotProps) {
  const styles = useAppStyles();
  const card = runCard(run.item);
  return (
    <View style={styles.flexCopy}>
      <View {...dragHandlers} style={styles.runDetailHeader}>
        <View style={styles.runDetailGrabber} />
        <View style={styles.contactRow}>
          <View style={styles.flexCopy}>
            <Text style={styles.eyebrow}>{card.badge ?? 'RUN'}</Text>
            <Text accessibilityRole="header" style={styles.recordTitle}>
              {card.when}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close run" onPress={close}>
            <Text style={styles.textButton}>Close</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.runDetailBody}>
        <View style={styles.metricRow}>
          <View style={styles.metricCell}>
            <Text style={styles.metricCellValue}>{card.distance}</Text>
            <Text style={styles.metricCellLabel}>Distance</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricCellValue}>{card.time}</Text>
            <Text style={styles.metricCellLabel}>Time</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricCellValue}>{card.pace}</Text>
            <Text style={styles.metricCellLabel}>Pace</Text>
          </View>
        </View>
        {card.result ? <Text style={styles.lead}>{card.result}</Text> : null}
      </ScrollView>
    </View>
  );
}
