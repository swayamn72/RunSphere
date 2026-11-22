import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import type { RunDetailSlotProps } from './RunDetailHost';
import { SECTION_RISE, SECTION_STAGGER_MS } from './run-detail-model';
import { routeThumbnailPath, runCard } from './run-log-model';
import { RunDetailMap } from './RunDetailMap';

/** The route area takes about 55% of the screen (9.19). */
export const ROUTE_AREA_SHARE = 0.55;

/**
 * One run, opened from a run log (M9 9.16–9.17; the map is 9.18, the full
 * layout 9.19). The header is the drag handle: pull it down, or press Back,
 * to close. As the card grows into this screen its route line fades out in
 * the route area, where the map fades in; the sections below rise into place
 * one after another.
 */
export function RunDetailScreen({
  run,
  close,
  dragHandlers,
  progress,
  reduceMotion
}: RunDetailSlotProps) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const card = runCard(run.item);
  const areaHeight = Math.round(height * ROUTE_AREA_SHARE);
  const line = routeThumbnailPath(run.item.route, 100, 12);
  const thumbnailFade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const mapFade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const lines = run.item.route ?? [];

  const section = (index: number, children: ReactNode) => (
    <Animated.View
      key={index}
      {...(reduceMotion
        ? {}
        : {
            entering: FadeInDown.delay(index * SECTION_STAGGER_MS)
              .duration(260)
              .withInitialValues({ opacity: 0, transform: [{ translateY: SECTION_RISE }] })
          })}
    >
      {children}
    </Animated.View>
  );

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
        {line ? (
          <View style={[styles.runDetailRouteArea, { height: areaHeight }]}>
            <Animated.View style={[styles.runDetailMapLayer, mapFade]}>
              <RunDetailMap
                lines={lines}
                reduceMotion={reduceMotion}
                accessibilityLabel={run.owner ? 'Your route' : 'Their route'}
              />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.runDetailThumbnail, thumbnailFade]}>
              <Svg
                width={Math.min(width - 36, areaHeight)}
                height={Math.min(width - 36, areaHeight)}
                viewBox="0 0 100 100"
                accessible={false}
              >
                <Path
                  d={line.path}
                  stroke={tokens.action.primary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <Circle
                  cx={line.start[0]}
                  cy={line.start[1]}
                  r={2.5}
                  fill={tokens.status.success}
                />
                <Circle
                  cx={line.finish[0]}
                  cy={line.finish[1]}
                  r={2.5}
                  fill={tokens.text.primary}
                />
              </Svg>
            </Animated.View>
          </View>
        ) : null}
        {section(
          0,
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
        )}
        {card.result ? section(1, <Text style={styles.lead}>{card.result}</Text>) : null}
      </ScrollView>
    </View>
  );
}
