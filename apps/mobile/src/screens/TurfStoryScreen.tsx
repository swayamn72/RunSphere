import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type StyleSpecification
} from '@maplibre/maplibre-react-native';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { radius, space } from '@runsphere/ui';
import { Text } from '../components/Text';
import { PrimaryButton } from '../components/primitives';
import { useAppTheme } from '../theme/theme';
import { useGameWorld } from '../theme/use-game-world';
import { resolveMapRenderPlan } from '../maps/map-config';
import { useMapBuildings } from '../maps/map-preferences';
import {
  cachedTurfWorldStyle,
  hasTurfWorldStyle,
  loadTurfWorldStyle
} from '../maps/turf-world-style-cache';
import {
  STORY_SCENES,
  formatArea,
  storyFrame,
  type LngLat,
  type StoryFrame
} from './turf-story-model';

/** How long the camera flies between scenes before the scene itself plays. */
const CAMERA_MS = 1_200;
const FRAME_MS = 33;

const polygons = (rings: readonly LngLat[][]): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection',
  features: rings.map((ring) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] }
  }))
});
const line = (coordinates: readonly LngLat[] | undefined): FeatureCollection<LineString> => ({
  type: 'FeatureCollection',
  features:
    coordinates && coordinates.length > 1
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [...coordinates] }
          }
        ]
      : []
});
const point = (at: LngLat | undefined): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: at
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }]
    : []
});

/**
 * "How Turf works" (plan Feature A): five scenes played out on the map, each
 * with a card. Made-up ground and players only (see `turf-story-model.ts`).
 * With reduce motion every scene shows its end state and the camera jumps.
 */
export function TurfStoryScreen({
  onDone,
  onStartRun
}: {
  onDone: () => void;
  /** The last scene ends on a run. Without it the button just closes. */
  onStartRun?: () => void;
}) {
  const { tokens, reduceMotion, colorScheme } = useAppTheme();
  const world = useGameWorld();
  const buildings = useMapBuildings();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const day = colorScheme === 'light';
  const plan = useMemo(() => resolveMapRenderPlan(), []);
  const providerUrl = plan.kind === 'provider' ? plan.provider.styleUrl : undefined;
  const [styleLoads, setStyleLoads] = useState(0);
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(reduceMotion ? 1 : 0);
  const cameraRef = useRef<CameraRef>(null);
  const scene = STORY_SCENES[index]!;
  const last = index === STORY_SCENES.length - 1;

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

  // Each scene: fly the camera, then play the scene's own animation.
  useEffect(() => {
    cameraRef.current?.setStop({
      center: scene.camera.center,
      zoom: scene.camera.zoom,
      pitch: scene.camera.pitch,
      bearing: scene.camera.bearing,
      duration: reduceMotion ? 0 : CAMERA_MS
    });
    if (reduceMotion) {
      setT(1);
      return;
    }
    setT(0);
    let started: number | undefined;
    const delay = setTimeout(() => {
      started = Date.now();
    }, CAMERA_MS * 0.6);
    const timer = setInterval(() => {
      if (started === undefined) return;
      const next = Math.min(1, (Date.now() - started) / scene.durationMs);
      setT(next);
      if (next >= 1) clearInterval(timer);
    }, FRAME_MS);
    return () => {
      clearTimeout(delay);
      clearInterval(timer);
    };
  }, [reduceMotion, scene]);

  const back = () => (index === 0 ? onDone() : setIndex(index - 1));
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => listener.remove();
  });

  const frame: StoryFrame = useMemo(() => storyFrame(scene.id, t), [scene.id, t]);
  const yoursLine = day ? world.route.quick : tokens.zone.owned;
  // The rival's line is theirs, so it takes their colour, not the route colours.
  const trailColour = frame.trailKind === 'rival' ? tokens.zone.rival : world.route.quick;

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        {mapStyle ? (
          <Map
            key={`story-${typeof mapStyle === 'string' ? 'provider' : colorScheme}-${buildings ? '3d' : 'flat'}`}
            style={StyleSheet.absoluteFill}
            mapStyle={mapStyle}
            attribution={false}
            logo={false}
            compass={false}
            scaleBar={false}
            dragPan={false}
            touchZoom={false}
            touchRotate={false}
            touchPitch={false}
            doubleTapZoom={false}
            doubleTapHoldZoom={false}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{
                center: STORY_SCENES[0]!.camera.center,
                zoom: STORY_SCENES[0]!.camera.zoom,
                pitch: STORY_SCENES[0]!.camera.pitch,
                bearing: STORY_SCENES[0]!.camera.bearing
              }}
            />
            <GeoJSONSource id="story-rivals" data={polygons(frame.rivals)}>
              <Layer
                id="story-rivals-fill"
                type="fill"
                paint={{
                  'fill-color': tokens.zone.rival,
                  'fill-opacity': 0.22 * frame.rivalsOpacity
                }}
              />
              <Layer
                id="story-rivals-line"
                type="line"
                paint={{
                  'line-color': tokens.zone.rival,
                  'line-width': 2.5,
                  'line-opacity': 0.9 * frame.rivalsOpacity
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource
              id="story-yours"
              data={polygons(frame.taken ? [...frame.yours, frame.taken] : frame.yours)}
            >
              <Layer
                id="story-yours-fill"
                type="fill"
                paint={{
                  'fill-color': tokens.zone.owned,
                  'fill-opacity': 0.32 * frame.yoursOpacity
                }}
              />
              {day && (
                <Layer
                  id="story-yours-casing"
                  type="line"
                  paint={{
                    'line-color': world.map.casing,
                    'line-width': 4.5,
                    'line-opacity': 0.55 * frame.yoursOpacity
                  }}
                />
              )}
              <Layer
                id="story-yours-line"
                type="line"
                paint={{
                  'line-color': yoursLine,
                  'line-width': 2.5,
                  'line-opacity': frame.yoursOpacity
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="story-taken" data={polygons(frame.taken ? [frame.taken] : [])}>
              <Layer
                id="story-taken-fill"
                type="fill"
                paint={{
                  'fill-color': tokens.zone.owned,
                  'fill-opacity': 0.55 * frame.takenOpacity
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource
              id="story-contested"
              data={polygons(frame.contested ? [frame.contested] : [])}
            >
              <Layer
                id="story-contested-line"
                type="line"
                paint={{
                  'line-color': tokens.zone.neutral,
                  'line-width': 4,
                  'line-dasharray': [1.5, 1.5]
                }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="story-trail" data={line(frame.trail)}>
              <Layer
                id="story-trail-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': trailColour, 'line-width': 5 }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="story-head" data={point(frame.head)}>
              <Layer
                id="story-head-dot"
                type="circle"
                paint={{
                  'circle-color': trailColour,
                  'circle-radius': 7,
                  'circle-stroke-color': world.route.markerRim,
                  'circle-stroke-width': 2
                }}
              />
            </GeoJSONSource>
            {frame.pins.map((pin) => (
              <Marker key={pin.id} id={`story-pin-${pin.id}`} lngLat={pin.lngLat}>
                <View style={[styles.pin, pin.kind === 'you' ? styles.pinYou : styles.pinRival]}>
                  <Text style={pin.kind === 'you' ? styles.pinYouText : styles.pinRivalText}>
                    {pin.label}
                  </Text>
                </View>
              </Marker>
            ))}
          </Map>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: world.map.night }]} />
        )}
      </View>

      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={index === 0 ? 'Close' : 'Back'}
          onPress={back}
          style={styles.roundButton}
        >
          <Text style={styles.roundButtonText}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip"
          onPress={onDone}
          style={styles.skip}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <View style={styles.card} accessibilityLiveRegion="polite">
        <View
          style={styles.progress}
          accessible
          accessibilityLabel={`Step ${index + 1} of ${STORY_SCENES.length}`}
        >
          {STORY_SCENES.map((entry, step) => (
            <View
              key={entry.id}
              style={[styles.progressBar, step <= index && styles.progressBarOn]}
            />
          ))}
        </View>
        <Text style={styles.eyebrow}>{scene.eyebrow}</Text>
        <Text style={styles.title} accessibilityRole="header">
          {scene.title}
        </Text>
        <Text style={styles.body}>{scene.body}</Text>
      </View>

      <View style={styles.bottom}>
        {frame.counter ? (
          <View
            style={styles.counter}
            accessible
            accessibilityLabel={`${formatArea(frame.counter.value)} square metres ${frame.counter.label.toLowerCase()}`}
          >
            <Text style={styles.counterValue}>{`${formatArea(frame.counter.value)} m²`}</Text>
            <Text style={styles.counterLabel}>{frame.counter.label}</Text>
          </View>
        ) : null}
        <PrimaryButton
          label={last ? (onStartRun ? 'Start a run' : 'Done') : 'Next'}
          onPress={() => (last ? (onStartRun ?? onDone)() : setIndex(index + 1))}
        />
      </View>
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingTop: space.md
    },
    roundButton: {
      alignItems: 'center',
      backgroundColor: tokens.background.paper,
      borderRadius: radius.pill,
      height: 48,
      justifyContent: 'center',
      width: 48
    },
    roundButtonText: { color: tokens.text.onPaper, fontSize: 28, lineHeight: 34 },
    skip: {
      alignItems: 'center',
      backgroundColor: tokens.background.paper,
      borderRadius: radius.pill,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: space.lg
    },
    skipText: { color: tokens.text.onPaper, fontSize: 15, fontWeight: '600' },
    card: {
      backgroundColor: tokens.background.paper,
      borderColor: tokens.border.paper,
      borderRadius: radius.card,
      borderWidth: 1,
      marginHorizontal: space.lg,
      marginTop: space.md,
      padding: space.xl
    },
    progress: { flexDirection: 'row', gap: space.xs, marginBottom: space.md },
    progressBar: {
      backgroundColor: tokens.border.paper,
      borderRadius: 2,
      height: 4,
      width: 22
    },
    progressBarOn: { backgroundColor: tokens.text.accent },
    eyebrow: {
      color: tokens.text.accent,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8,
      marginBottom: space.xs
    },
    title: { color: tokens.text.onPaper, fontSize: 28, fontWeight: '700', lineHeight: 34 },
    body: { color: tokens.text.onPaperMuted, fontSize: 15, lineHeight: 22, marginTop: space.sm },
    bottom: {
      bottom: 0,
      gap: space.md,
      left: 0,
      padding: space.lg,
      paddingBottom: space.xxl,
      position: 'absolute',
      right: 0
    },
    counter: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: tokens.background.paper,
      borderRadius: radius.card,
      paddingHorizontal: space.xl,
      paddingVertical: space.md
    },
    counterValue: { color: tokens.text.onPaper, fontSize: 24, fontWeight: '700' },
    counterLabel: {
      color: tokens.text.accent,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8
    },
    pin: {
      borderRadius: radius.pill,
      borderWidth: 2,
      paddingHorizontal: space.sm,
      paddingVertical: space.xxs
    },
    pinYou: { backgroundColor: tokens.zone.owned, borderColor: tokens.text.onAccent },
    pinRival: { backgroundColor: tokens.background.paper, borderColor: tokens.zone.rival },
    pinYouText: { color: tokens.text.onAccent, fontSize: 12, fontWeight: '700' },
    pinRivalText: { color: tokens.text.onPaper, fontSize: 12, fontWeight: '700' }
  });
