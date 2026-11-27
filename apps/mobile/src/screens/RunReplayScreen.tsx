import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type StyleSpecification
} from '@maplibre/maplibre-react-native';
import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson';
import Svg, { Path } from 'react-native-svg';
import { radius, space } from '@runsphere/ui';
import { Text } from '../components/Text';
import { useAppTheme } from '../theme/theme';
import { useGameWorld } from '../theme/use-game-world';
import { resolveMapRenderPlan } from '../maps/map-config';
import { useMapBuildings } from '../maps/map-preferences';
import {
  cachedTurfWorldStyle,
  hasTurfWorldStyle,
  loadTurfWorldStyle
} from '../maps/turf-world-style-cache';
import { FIT_PADDING, FRAME_MS, routeBounds, sliceRoute, type Lines } from './route-draw-model';
import { paceClock } from './run-metrics-preview-model';
import { routeThumbnailPath } from './run-log-model';
import {
  REPLAY_DURATION_MS,
  easedReplayProgress,
  formatReplayClock,
  formatReplayDistance
} from './run-replay-model';

const multiLine = (lines: Lines): FeatureCollection<MultiLineString> => ({
  type: 'FeatureCollection',
  features: lines.length
    ? [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiLineString',
            coordinates: lines.map((line) => line.map(([lng, lat]) => [lng, lat]))
          }
        }
      ]
    : []
});
const drawn = (lines: Lines): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features: lines
    .filter((line) => line.length > 1)
    .map((line) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: line.map(([lng, lat]) => [lng, lat]) }
    }))
});
const point = (at: readonly [number, number] | undefined): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: at
    ? [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [at[0], at[1]] }
        }
      ]
    : []
});

/**
 * Reveal the full run in one short draw, with the route framed for the entire
 * animation. The route has already been trimmed for privacy (ADR-0002).
 */
export function RunReplayScreen({
  lines,
  distanceMeters,
  averagePace,
  elapsedSeconds,
  onClose
}: {
  lines: Lines;
  distanceMeters: number;
  averagePace: number | null;
  elapsedSeconds: number;
  onClose: () => void;
}) {
  const { tokens, reduceMotion, colorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const world = useGameWorld();
  const buildings = useMapBuildings();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const day = colorScheme === 'light';
  const plan = useMemo(() => resolveMapRenderPlan(), []);
  const providerUrl = plan.kind === 'provider' ? plan.provider.styleUrl : undefined;
  const [styleLoads, setStyleLoads] = useState(0);
  const cameraRef = useRef<CameraRef>(null);
  const [progress, setProgress] = useState(reduceMotion ? 1 : 0);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [readyStyle, setReadyStyle] = useState<StyleSpecification | string>();

  const bounds = useMemo(() => routeBounds(lines), [lines]);
  const fallbackRoute = useMemo(() => routeThumbnailPath(lines, 240, 16), [lines]);
  const slice = useMemo(() => sliceRoute(lines, progress), [lines, progress]);
  const start = lines.find((line) => line.length > 0)?.[0];

  useEffect(() => {
    if (!providerUrl || hasTurfWorldStyle(providerUrl)) return;
    let current = true;
    void loadTurfWorldStyle(providerUrl, { scheme: colorScheme, buildings }).then(() => {
      if (current) setStyleLoads((count) => count + 1);
    });
    return () => {
      current = false;
    };
    // Only the first download matters; variants are built from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerUrl]);
  const mapStyle = useMemo<StyleSpecification | string | undefined>(
    () =>
      providerUrl
        ? (cachedTurfWorldStyle(providerUrl, { scheme: colorScheme, buildings }) ??
          (hasTurfWorldStyle(providerUrl) ? providerUrl : undefined))
        : undefined,
    // styleLoads: re-read the cache once the download has landed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, colorScheme, providerUrl, styleLoads]
  );

  const mapReady = mapStyle !== undefined && readyStyle === mapStyle;
  useEffect(() => {
    if (!playing || !mapReady) return;
    const started = Date.now();
    const timer = setInterval(() => {
      setProgress(easedReplayProgress(Date.now() - started));
    }, FRAME_MS);
    const finish = setTimeout(() => {
      clearInterval(timer);
      setProgress(1);
      setPlaying(false);
    }, REPLAY_DURATION_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(finish);
    };
  }, [playing, mapReady]);

  const replay = () => {
    setProgress(0);
    setPlaying(true);
  };

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => listener.remove();
  }, [onClose]);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        {mapStyle ? (
          <Map
            key={`replay-${typeof mapStyle === 'string' ? 'provider' : colorScheme}-${buildings ? '3d' : 'flat'}`}
            accessibilityLabel="Your route, replaying"
            style={StyleSheet.absoluteFill}
            mapStyle={mapStyle}
            attribution={false}
            logo={false}
            compass={false}
            scaleBar={false}
            onDidFinishLoadingStyle={() => {
              if (bounds)
                cameraRef.current?.fitBounds(bounds, {
                  padding: {
                    top: insets.top + 155,
                    right: insets.right + FIT_PADDING,
                    bottom: insets.bottom + 105,
                    left: insets.left + FIT_PADDING
                  },
                  duration: 0
                });
              setReadyStyle(mapStyle);
            }}
          >
            <Camera
              ref={cameraRef}
              maxZoom={18}
              {...(start
                ? {
                    initialViewState: {
                      center: [start[0], start[1]] as [number, number],
                      zoom: 15
                    }
                  }
                : {})}
            />
            <GeoJSONSource id="replay-whole" data={multiLine(lines)}>
              <Layer
                id="replay-whole-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': world.route.quick, 'line-width': 3, 'line-opacity': 0.22 }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="replay-drawn" data={drawn(slice.lines)}>
              {day && (
                <Layer
                  id="replay-drawn-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': world.map.casing, 'line-width': 8, 'line-opacity': 0.35 }}
                />
              )}
              <Layer
                id="replay-drawn-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': world.route.quick, 'line-width': 5 }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="replay-start" data={point(start)}>
              <Layer
                id="replay-start-dot"
                type="circle"
                paint={{
                  'circle-color': world.route.start,
                  'circle-radius': 6,
                  'circle-stroke-color': world.route.markerRim,
                  'circle-stroke-width': 2
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="replay-head" data={point(slice.head)}>
              <Layer
                id="replay-head-dot"
                type="circle"
                paint={{
                  'circle-color': world.route.head,
                  'circle-radius': 8,
                  'circle-stroke-color': world.route.markerRim,
                  'circle-stroke-width': 3
                }}
              />
            </GeoJSONSource>
          </Map>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            {fallbackRoute ? (
              <Svg width="80%" height="55%" viewBox="0 0 240 240">
                <Path
                  d={fallbackRoute.path}
                  stroke={world.route.quick}
                  strokeWidth={4}
                  fill="none"
                />
              </Svg>
            ) : null}
          </View>
        )}
      </View>

      <View
        style={[
          styles.top,
          {
            paddingTop: insets.top + space.md,
            paddingLeft: insets.left + space.lg,
            paddingRight: insets.right + space.lg
          }
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close replay"
          onPress={onClose}
          style={styles.round}
        >
          <Text style={styles.roundText}>‹</Text>
        </Pressable>
        <View style={styles.stats} accessible accessibilityRole="summary">
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatReplayDistance(distanceMeters)}</Text>
            <Text style={styles.statLabel}>KM</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatReplayClock(elapsedSeconds)}</Text>
            <Text style={styles.statLabel}>ELAPSED</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{paceClock(averagePace)}</Text>
            <Text style={styles.statLabel}>AVG PACE /KM</Text>
          </View>
        </View>
      </View>

      {mapReady && !playing && (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay route"
            onPress={replay}
            style={styles.play}
          >
            <Text style={styles.playText}>Replay</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    fallback: { alignItems: 'center', justifyContent: 'center' },
    top: { gap: space.md },
    round: {
      alignItems: 'center',
      backgroundColor: tokens.background.paper,
      borderRadius: radius.pill,
      height: 48,
      justifyContent: 'center',
      width: 48
    },
    roundText: { color: tokens.text.onPaper, fontSize: 24, fontWeight: '600' },
    stats: {
      backgroundColor: tokens.background.paper,
      borderRadius: radius.card,
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: space.md
    },
    stat: { alignItems: 'center' },
    statValue: {
      color: tokens.text.onPaper,
      fontSize: 24,
      fontVariant: ['tabular-nums'],
      fontWeight: '700'
    },
    statLabel: {
      color: tokens.text.onPaperMuted,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8
    },
    bottom: {
      alignItems: 'center',
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0
    },
    play: {
      alignItems: 'center',
      backgroundColor: tokens.action.primary,
      borderRadius: radius.pill,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: space.xl
    },
    playText: { color: tokens.text.onAccent, fontSize: 15, fontWeight: '700' }
  });
