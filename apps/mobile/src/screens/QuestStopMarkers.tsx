import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Marker } from '@maplibre/maplibre-react-native';
import { gameWorld } from '../theme/game-world';
import type { QuestStop } from './quest-map-model';

/**
 * A quest's stops as numbered pins, in the suggested order. On a live run a
 * passed stop shows a tick in the passed colour, so the next number is the
 * next place to go.
 */
export function QuestStopMarkers({
  stops,
  passed
}: {
  stops: readonly QuestStop[];
  passed?: ReadonlySet<string>;
}) {
  return (
    <>
      {stops.map((stop) => {
        const done = passed?.has(stop.id) ?? false;
        return (
          <Marker key={stop.id} id={`quest-stop-${stop.id}`} lngLat={[stop.at[0], stop.at[1]]}>
            <View
              accessible
              accessibilityLabel={`Stop ${stop.number}: ${stop.title}${done ? ', passed' : ''}`}
              style={[styles.pin, done && styles.passed]}
            >
              <Text style={styles.number} allowFontScaling={false}>
                {done ? '✓' : stop.number}
              </Text>
            </View>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  pin: {
    alignItems: 'center',
    backgroundColor: gameWorld.quest.marker,
    borderColor: gameWorld.quest.markerEdge,
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32
  },
  passed: { backgroundColor: gameWorld.quest.passed },
  number: { color: gameWorld.quest.ink, fontSize: 15, fontWeight: '700' }
});
