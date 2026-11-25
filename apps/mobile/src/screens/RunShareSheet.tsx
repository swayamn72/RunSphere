import { useRef, useState } from 'react';
import { Modal, Pressable, View, type TextStyle, type ViewStyle } from 'react-native';
import { radius, space, typeScale } from '@runsphere/ui';
import Svg, { Circle, Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { Text } from '../components/Text';
import { failureMessage } from '../failure-copy';
import { gameWorld } from '../theme/game-world';
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  SHARE_IMAGE_SCALE,
  SHARE_ROUTE_SIZE,
  type RunShareCard
} from './run-share-model';

export const SHARE_UNAVAILABLE = "Sharing isn't available on this phone.";
export const SHARE_FAILED = "Couldn't make the image. Try again.";

/**
 * The run as an image to share (see `run-share-model.ts`): a preview of the
 * card, and Share, which captures exactly what the preview shows.
 */
export function RunShareSheet({
  card,
  visible,
  onClose
}: {
  card: RunShareCard;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useAppStyles();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const share = async () => {
    setNotice('');
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setNotice(SHARE_UNAVAILABLE);
        return;
      }
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: SHARE_CARD_WIDTH * SHARE_IMAGE_SCALE,
        height: SHARE_CARD_HEIGHT * SHARE_IMAGE_SCALE
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your run',
        UTI: 'public.png'
      });
    } catch (error) {
      setNotice(failureMessage(error, SHARE_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[local.backdrop, { backgroundColor: gameWorld.hud.sheet }]}>
        <View ref={cardRef} collapsable={false} accessible accessibilityLabel={card.summary}>
          <ShareCardFace card={card} />
        </View>
        {notice ? (
          <Text style={styles.provisional} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        <View style={local.actions}>
          <PrimaryButton
            label={busy ? 'Making your image…' : 'Share'}
            accessibilityLabel="Share your run"
            disabled={busy}
            onPress={() => void share()}
          />
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The card itself, at a fixed size and in the dark game-world colours whatever
 * the phone's theme, so the image is the same on every phone.
 */
export function ShareCardFace({ card }: { card: RunShareCard }) {
  return (
    <View style={[local.card, { backgroundColor: gameWorld.map.night }]}>
      <View style={local.header}>
        <Text style={[local.brand, { color: gameWorld.route.quick }]}>TURFR</Text>
        <Text style={[local.date, { color: gameWorld.hud.textSoft }]}>{card.dateLabel}</Text>
      </View>
      <Text style={[local.title, { color: gameWorld.hud.text }]}>{card.title}</Text>
      <View style={local.route}>
        {card.route ? (
          <Svg width={SHARE_ROUTE_SIZE} height={SHARE_ROUTE_SIZE}>
            <Path
              d={card.route.path}
              stroke={gameWorld.route.quick}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Circle
              cx={card.route.start[0]}
              cy={card.route.start[1]}
              r={6}
              fill={gameWorld.route.start}
              stroke={gameWorld.route.markerRim}
              strokeWidth={2}
            />
            <Circle
              cx={card.route.finish[0]}
              cy={card.route.finish[1]}
              r={6}
              fill={gameWorld.route.finish}
              stroke={gameWorld.route.markerRim}
              strokeWidth={2}
            />
          </Svg>
        ) : null}
      </View>
      <View style={local.stats}>
        {card.stats.map((stat) => (
          <View key={stat.label} style={local.stat}>
            <Text style={[local.statValue, { color: gameWorld.hud.text }]}>{stat.value}</Text>
            <Text style={[local.statLabel, { color: gameWorld.hud.textSoft }]}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const local: Record<string, ViewStyle | TextStyle> = {
  backdrop: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: space.lg },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  card: {
    borderRadius: radius.card,
    height: SHARE_CARD_HEIGHT,
    overflow: 'hidden',
    padding: space.xl,
    width: SHARE_CARD_WIDTH
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { fontSize: typeScale.subheading.size, fontWeight: '700', letterSpacing: 2 },
  date: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: typeScale.heading.size, fontWeight: '700', marginTop: 6 },
  route: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  stat: { marginTop: space.sm, minWidth: '22%' },
  statValue: { fontSize: 17, fontVariant: ['tabular-nums'], fontWeight: '700' },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: space.xxs }
};
