import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import type { ActivityMetrics } from '@runsphere/contracts';
import { useAppStyles } from '../components/styles';
import { gameWorld } from '../theme/game-world';
import { useAppTheme } from '../theme/theme';
import { chartPath, scrubAt, type Scrub } from './run-detail-layout-model';
import type { Lines } from './route-draw-model';

export const CHART_HEIGHT = 96;

/**
 * A pace or elevation chart you can scrub (M9 9.19): drag across it and a
 * vertical cursor shows the value at that distance, while `onScrub` moves a
 * dot to the same place on the map. Letting go keeps the reading.
 */
export function RunChart({
  kind,
  metrics,
  lines,
  width,
  onScrub
}: {
  kind: 'pace' | 'elevation';
  metrics: ActivityMetrics;
  lines: Lines;
  width: number;
  onScrub: (scrub: Scrub | undefined) => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const series = kind === 'pace' ? metrics.paceSeries : metrics.elevationSeries;
  const geometry = useMemo(
    () => chartPath(series, width, CHART_HEIGHT, kind === 'pace'),
    [series, width, kind]
  );
  const [cursor, setCursor] = useState<{ x: number; scrub: Scrub }>();
  const latest = useRef({ width, metrics, lines, onScrub });
  latest.current = { width, metrics, lines, onScrub };
  const pan = useMemo(() => {
    const move = (x: number) => {
      const { width: w, metrics: m, lines: l, onScrub: report } = latest.current;
      const clamped = Math.min(w, Math.max(0, x));
      const scrub = scrubAt(clamped, w, m, l, kind);
      setCursor({ x: clamped, scrub });
      report(scrub);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: (event) => move(event.nativeEvent.locationX),
      onPanResponderMove: (event) => move(event.nativeEvent.locationX)
    });
  }, [kind]);

  if (!geometry) return null;
  const title = kind === 'pace' ? 'Pace' : 'Elevation';
  return (
    <View>
      <View style={styles.chartHeader}>
        <Text style={styles.runWeekTitle}>{title.toUpperCase()}</Text>
        <Text style={styles.runCardMeta} accessibilityLiveRegion="polite">
          {cursor?.scrub.label ?? 'Drag across to see any point'}
        </Text>
      </View>
      <View
        {...pan.panHandlers}
        accessible
        accessibilityLabel={`${title} chart`}
        accessibilityHint="Drag across to read the value at each point of your run."
      >
        <Svg width={width} height={CHART_HEIGHT}>
          <Path
            d={geometry.path}
            stroke={kind === 'pace' ? gameWorld.route.quick : tokens.text.secondary}
            strokeWidth={2}
            fill="none"
          />
          {cursor ? (
            <Line
              x1={cursor.x}
              x2={cursor.x}
              y1={0}
              y2={CHART_HEIGHT}
              stroke={tokens.text.primary}
              strokeWidth={1}
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}
