import { Pressable, Text, View } from 'react-native';
import type { PrivacyZoneResponse } from '@runsphere/contracts';
import { useAppStyles } from '../components/styles';

/**
 * The runner's saved privacy zones, each with a way to remove it (M3.6). A
 * zone's center is never shown: the name is what the runner chose to call
 * the place, and that is enough to recognise it.
 */
export function PrivacyZoneList({
  zones,
  onRemove
}: {
  zones: readonly PrivacyZoneResponse[];
  onRemove: (zone: PrivacyZoneResponse) => void;
}) {
  const styles = useAppStyles();
  if (zones.length === 0) return <Text style={styles.privateNote}>No privacy zones yet.</Text>;
  return (
    <>
      {zones.map((zone) => (
        <View key={zone.id} style={styles.contactRow}>
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>{zone.name}</Text>
            <Text style={styles.rowDetail}>{`${zone.radiusMeters} m around a saved center`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove privacy zone ${zone.name}`}
            onPress={() => onRemove(zone)}
          >
            <Text style={[styles.link, styles.destructive]}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </>
  );
}
