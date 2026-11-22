import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { ActivityMetrics } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { useAppStyles } from '../components/styles';
import { failureMessage } from '../failure-copy';
import { useAppTheme } from '../theme/theme';
import type { RunDetailSlotProps } from './RunDetailHost';
import { RunDetailMap } from './RunDetailMap';
import { RunChart } from './RunCharts';
import { SECTION_RISE, SECTION_STAGGER_MS } from './run-detail-model';
import {
  DELETE_CONFIRM,
  DELETE_FAILED,
  bestEffortRows,
  linesFromGeometry,
  splitRows,
  statCells,
  thinLines,
  type Scrub
} from './run-detail-layout-model';
import { routeThumbnailPath, runCard } from './run-log-model';

/** The route area takes about 55% of the screen, and shrinks to half that as you scroll. */
export const ROUTE_AREA_SHARE = 0.55;

export type RunDetailApi = Pick<MobileApiClient, 'activityStatus' | 'deleteActivity'>;

/**
 * One run, opened from a run log (M9 9.16–9.19). The header is the drag
 * handle: pull it down, or press Back, to close.
 *
 * Your own run loads its metrics and full trimmed route from the server, so it
 * shows splits, charts and best efforts, and can be deleted. Someone else's run
 * shows only what their run log item carries (9.14, 9.20).
 */
export function RunDetailScreen({
  run,
  close,
  dragHandlers,
  progress,
  reduceMotion,
  api
}: RunDetailSlotProps & { api: RunDetailApi }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const card = runCard(run.item);
  const areaHeight = Math.round(height * ROUTE_AREA_SHARE);
  const contentWidth = width - 36;
  const [metrics, setMetrics] = useState<ActivityMetrics>();
  const [fullLines, setFullLines] = useState<[number, number][][]>();
  const [loading, setLoading] = useState(run.owner);
  const [scrub, setScrub] = useState<Scrub>();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!run.owner) return;
    let active = true;
    void api
      .activityStatus(run.item.id)
      .then((detail) => {
        if (!active) return;
        if (detail.metrics) setMetrics(detail.metrics);
        const lines = linesFromGeometry(detail.geometry);
        if (lines?.length) setFullLines(thinLines(lines));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, run.owner, run.item.id]);

  const lines = useMemo(() => fullLines ?? run.item.route ?? [], [fullLines, run.item.route]);
  const line = routeThumbnailPath(run.item.route, 100, 12);
  const scroll = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.y;
  });
  const area = useAnimatedStyle(() => ({
    height: interpolate(
      scroll.value,
      [0, areaHeight / 2],
      [areaHeight, areaHeight / 2],
      Extrapolation.CLAMP
    )
  }));
  const thumbnailFade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const mapFade = useAnimatedStyle(() => ({ opacity: progress.value }));

  const remove = async () => {
    setDeleting(true);
    setNotice('');
    try {
      await api.deleteActivity(run.item.id);
      run.onDeleted?.();
      close();
    } catch (error) {
      setNotice(failureMessage(error, DELETE_FAILED));
      setDeleting(false);
    }
  };

  let order = 0;
  const section = (children: ReactNode) => {
    const index = order++;
    return (
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
  };

  const splits = splitRows(metrics);
  const efforts = bestEffortRows(metrics);

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
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.runDetailBody}
      >
        {lines.length ? (
          <Animated.View style={[styles.runDetailRouteArea, area]}>
            <Animated.View style={[styles.runDetailMapLayer, mapFade]}>
              <RunDetailMap
                lines={lines}
                paceSeries={metrics?.paceSeries}
                reduceMotion={reduceMotion}
                marker={scrub?.position}
                accessibilityLabel={run.owner ? 'Your route' : 'Their route'}
              />
            </Animated.View>
            {line ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.runDetailThumbnail, thumbnailFade]}
              >
                <Svg
                  width={Math.min(contentWidth, areaHeight)}
                  height={Math.min(contentWidth, areaHeight)}
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
            ) : null}
          </Animated.View>
        ) : null}

        {card.result
          ? section(
              <View style={styles.runResultCard}>
                <Text style={styles.eyebrow}>{card.badge ?? 'RUN'}</Text>
                <Text style={styles.rowTitle}>{card.result}</Text>
              </View>
            )
          : null}

        {section(
          <View style={styles.runStatGrid}>
            {statCells(run.item, metrics).map((cell) => (
              <View key={cell.label} style={styles.runStatCell}>
                <Text style={styles.metricCellValue}>{cell.value}</Text>
                <Text style={styles.metricCellLabel}>{cell.label}</Text>
              </View>
            ))}
          </View>
        )}

        {loading ? <Text style={styles.muted}>Loading your splits…</Text> : null}

        {splits.length
          ? section(
              <View>
                <Text style={styles.runWeekTitle}>SPLITS</Text>
                {splits.map((split) => (
                  <View
                    key={split.label}
                    style={styles.splitRow}
                    accessible
                    accessibilityLabel={[
                      split.label,
                      `${split.pace} per km`,
                      split.climb,
                      split.fastest ? 'best km' : null
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  >
                    <Text style={styles.splitLabel}>
                      {split.fastest ? `${split.label} · Best` : split.label}
                    </Text>
                    <View style={styles.splitBarTrack}>
                      <View
                        style={[
                          styles.splitBar,
                          { width: `${Math.round(split.bar * 100)}%` as `${number}%` }
                        ]}
                      />
                    </View>
                    <Text style={styles.splitValue}>
                      {split.climb ? `${split.pace} · ${split.climb}` : split.pace}
                    </Text>
                  </View>
                ))}
              </View>
            )
          : null}

        {metrics && metrics.paceSeries.length > 1
          ? section(
              <RunChart
                kind="pace"
                metrics={metrics}
                lines={lines}
                width={contentWidth}
                onScrub={setScrub}
              />
            )
          : null}
        {metrics && metrics.elevationSeries.length > 1
          ? section(
              <RunChart
                kind="elevation"
                metrics={metrics}
                lines={lines}
                width={contentWidth}
                onScrub={setScrub}
              />
            )
          : null}

        {efforts.length
          ? section(
              <View>
                <Text style={styles.runWeekTitle}>BEST EFFORTS</Text>
                {efforts.map((effort) => (
                  <View key={effort.label} style={styles.splitRow}>
                    <Text style={styles.splitLabel}>{effort.label}</Text>
                    <Text style={styles.splitValue}>{effort.value}</Text>
                  </View>
                ))}
              </View>
            )
          : null}

        {run.owner
          ? section(
              <View style={styles.runDeleteArea}>
                {confirming ? (
                  <>
                    <Text style={styles.rowDetail}>{DELETE_CONFIRM}</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={deleting}
                      onPress={() => void remove()}
                    >
                      <Text style={[styles.textButton, styles.destructive]}>
                        {deleting ? 'Deleting…' : 'Yes, delete it'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={deleting}
                      onPress={() => setConfirming(false)}
                    >
                      <Text style={styles.textButton}>Keep it</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => setConfirming(true)}>
                    <Text style={[styles.textButton, styles.destructive]}>Delete run</Text>
                  </Pressable>
                )}
                {notice !== '' ? (
                  <Text style={styles.rowDetail} accessibilityLiveRegion="polite">
                    {notice}
                  </Text>
                ) : null}
              </View>
            )
          : null}
      </Animated.ScrollView>
    </View>
  );
}
