import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Map,
  type CameraRef,
  type LngLat,
  type ViewStateChangeEvent
} from '@maplibre/maplibre-react-native';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { LocalGeoJsonLayers, type LocalGeoJsonLayer } from './LocalGeoJsonLayers';
import { mapProductCopy, resolveMapRenderPlan } from './map-config';
import {
  adjustMapZoom,
  applyNativeCameraState,
  assertAttributionFontSize,
  attributionFontSize,
  initialMapCameraState,
  recenterMap,
  resetCompass,
  transitionMapLifecycle,
  type MapCameraState,
  type MapLifecycleState
} from './map-model';

export interface MapSurfaceProps {
  readonly localLayers?: readonly LocalGeoJsonLayer[];
  /** A host-generated request result. Each id is applied once and never triggers a permission request. */
  readonly recenterRequest?: { readonly id: number; readonly coordinate: LngLat };
  /** Enables recenter when the host can handle a request; it may remain enabled before a coordinate exists. */
  readonly recenterEnabled?: boolean;
  /** An intentional product camera center. Omit it to use a neutral world view, never [0, 0]. */
  readonly initialCenter?: LngLat;
  /** A private host-held center used only to move the native camera while following. */
  readonly liveCenter?: LngLat;
  /** Starts or restores camera follow after a usable local fix. */
  readonly initialFollow?: boolean;
  /** Called when a native gesture exits follow; no coordinates are reported. */
  readonly onEnterFreePan?: () => void;
  readonly onRequestRecenter?: () => void;
  /** Lets a host surface independently observed offline/style/tile failures. */
  readonly fallbackState?: Extract<MapLifecycleState, 'offline' | 'style-error' | 'tile-error'>;
  readonly accessibilityLabel: string;
}

/**
 * A privacy-safe base primitive. It does not request location, issue product
 * network requests, or place local GeoJSON in provider traffic.
 */
export function MapSurface({
  localLayers = [],
  recenterRequest,
  recenterEnabled,
  initialCenter,
  liveCenter,
  initialFollow = false,
  onEnterFreePan,
  onRequestRecenter,
  fallbackState,
  accessibilityLabel
}: MapSurfaceProps) {
  const { tokens, reduceMotion } = useAppTheme();
  const providerConfig = useMemo(() => resolveMapRenderPlan(), []);
  const [lifecycle, setLifecycle] = useState<MapLifecycleState>(
    fallbackState ?? (providerConfig.kind === 'provider' ? 'loading' : 'fallback')
  );
  const [camera, setCamera] = useState<MapCameraState>(initialMapCameraState);
  const cameraMode = useRef(initialMapCameraState.mode);
  const [mapInstance, setMapInstance] = useState(0);
  const cameraRef = useRef<CameraRef>(null);
  const appliedRecenterRequest = useRef<number | undefined>(undefined);
  const hasStartedFollowing = useRef(false);

  useEffect(() => {
    if (fallbackState) setLifecycle(fallbackState);
    else if (providerConfig.kind === 'provider') setLifecycle('loading');
  }, [fallbackState, providerConfig.kind]);

  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      setLifecycle((current) =>
        transitionMapLifecycle(current, nextState === 'active' ? 'foreground' : 'background')
      );
      if (nextState === 'active') setMapInstance((current) => current + 1);
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  const isProviderMap =
    providerConfig.kind === 'provider' && lifecycle === 'ready' && !fallbackState;
  const isLoadingProvider =
    providerConfig.kind === 'provider' && lifecycle === 'loading' && !fallbackState;
  const showMap = isProviderMap || isLoadingProvider;

  const moveCamera = (update: (current: MapCameraState) => MapCameraState, center?: LngLat) => {
    setCamera((current) => {
      const next = update(current);
      if (center) {
        if (reduceMotion)
          cameraRef.current?.jumpTo({ center, zoom: next.zoom, bearing: next.bearing });
        else
          cameraRef.current?.easeTo({
            center,
            zoom: next.zoom,
            bearing: next.bearing,
            duration: 250
          });
      } else cameraRef.current?.setStop({ zoom: next.zoom, bearing: next.bearing, duration: 0 });
      return next;
    });
  };

  const onRegionChanged = (event: { nativeEvent: ViewStateChangeEvent }) => {
    const { zoom, bearing, userInteraction } = event.nativeEvent;
    if (userInteraction && cameraMode.current !== 'free-pan') {
      cameraMode.current = 'free-pan';
      onEnterFreePan?.();
    }
    setCamera((current) => {
      const next = applyNativeCameraState(current, { zoom, bearing }, userInteraction);
      cameraMode.current = next.mode;
      return next;
    });
  };

  const retry = () => {
    if (providerConfig.kind !== 'provider' || fallbackState) return;
    setLifecycle((current) => transitionMapLifecycle(current, 'retry'));
    setMapInstance((current) => current + 1);
  };
  const resetNorth = () => moveCamera(resetCompass);
  const zoom = (amount: number) => moveCamera((current) => adjustMapZoom(current, amount));
  const recenter = () => onRequestRecenter?.();

  // A host may obtain a foreground coordinate only after an explicit recenter press.
  // Apply its uniquely identified result once; theme changes (including reduced motion) never replay it.
  useEffect(() => {
    if (!recenterRequest || appliedRecenterRequest.current === recenterRequest.id) return;
    appliedRecenterRequest.current = recenterRequest.id;
    cameraMode.current = 'follow';
    setCamera((current) => {
      const next = recenterMap(current);
      if (reduceMotion)
        cameraRef.current?.jumpTo({
          center: recenterRequest.coordinate,
          zoom: next.zoom,
          bearing: next.bearing
        });
      else
        cameraRef.current?.easeTo({
          center: recenterRequest.coordinate,
          zoom: next.zoom,
          bearing: next.bearing,
          duration: 250
        });
      return next;
    });
  }, [recenterRequest, reduceMotion]);

  // Local live centers never enter provider configuration. They only update the native
  // camera while this renderer is already in follow mode.
  useEffect(() => {
    if (!liveCenter) return;
    setCamera((current) => {
      const shouldStartFollowing = initialFollow && !hasStartedFollowing.current;
      if (shouldStartFollowing) hasStartedFollowing.current = true;
      const next = shouldStartFollowing ? { ...current, mode: 'follow' as const } : current;
      if (next.mode !== 'follow') return next;
      if (reduceMotion)
        cameraRef.current?.jumpTo({ center: liveCenter, zoom: next.zoom, bearing: next.bearing });
      else
        cameraRef.current?.easeTo({
          center: liveCenter,
          zoom: next.zoom,
          bearing: next.bearing,
          duration: 250
        });
      return next;
    });
  }, [initialFollow, liveCenter, reduceMotion]);

  const fallbackMessage =
    fallbackState === 'offline' || lifecycle === 'offline'
      ? mapProductCopy('offline')
      : mapProductCopy('unavailable');
  const initialViewState = initialCenter
    ? { center: initialCenter, zoom: initialMapCameraState.zoom }
    : { zoom: 1 };

  return (
    <View style={[styles.root, { backgroundColor: tokens.background.surfaceInset }]}>
      {showMap && providerConfig.kind === 'provider' ? (
        <Map
          key={mapInstance}
          accessibilityLabel={accessibilityLabel}
          style={StyleSheet.absoluteFill}
          mapStyle={providerConfig.provider.styleUrl}
          attribution={false}
          logo={false}
          compass={false}
          scaleBar={false}
          tintColor={tokens.map.controlText}
          onDidFinishLoadingStyle={() =>
            setLifecycle((current) => transitionMapLifecycle(current, 'style-loaded'))
          }
          onDidFailLoadingMap={() =>
            setLifecycle((current) => transitionMapLifecycle(current, 'style-failed'))
          }
          onRegionDidChange={onRegionChanged}
        >
          <Camera ref={cameraRef} initialViewState={initialViewState} />
          <LocalGeoJsonLayers layers={localLayers} tokens={tokens} />
        </Map>
      ) : (
        <FallbackSurface
          message={fallbackMessage}
          canRetry={providerConfig.kind === 'provider' && !fallbackState}
          onRetry={retry}
        />
      )}

      {showMap && (
        <MapControls
          camera={camera}
          tokens={tokens}
          onZoomIn={() => zoom(1)}
          onZoomOut={() => zoom(-1)}
          onResetNorth={resetNorth}
          onRecenter={recenter}
          recenterDisabled={!(recenterEnabled ?? Boolean(onRequestRecenter))}
        />
      )}
      {isProviderMap && providerConfig.kind === 'provider' && (
        <Text
          accessible
          accessibilityLabel={`Map attribution: ${providerConfig.provider.attribution}`}
          style={[
            styles.attribution,
            { backgroundColor: tokens.map.scrim, color: tokens.map.controlText }
          ]}
        >
          {providerConfig.provider.attribution}
        </Text>
      )}
    </View>
  );
}

function FallbackSurface({
  message,
  canRetry,
  onRetry
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <View style={[styles.fallback, { backgroundColor: tokens.background.surfaceInset }]}>
      <View
        importantForAccessibility="no"
        style={[styles.fallbackOrbit, { borderColor: tokens.route.line }]}
      />
      <Text style={[styles.fallbackTitle, { color: tokens.text.primary }]}>{message}</Text>
      <Text style={[styles.fallbackDetail, { color: tokens.text.secondary }]}>
        Use the list for all available details.
      </Text>
      {canRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry map details"
          onPress={onRetry}
          style={[
            styles.retry,
            { borderColor: tokens.border.subtle, backgroundColor: tokens.map.control }
          ]}
        >
          <Text style={[styles.retryText, { color: tokens.map.controlText }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

function MapControls({
  camera,
  tokens,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onRecenter,
  recenterDisabled
}: {
  camera: MapCameraState;
  tokens: ReturnType<typeof useAppTheme>['tokens'];
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onRecenter: () => void;
  recenterDisabled: boolean;
}) {
  const control = [
    styles.control,
    { backgroundColor: tokens.map.control, borderColor: tokens.border.subtle }
  ];
  const controlText = { color: tokens.map.controlText };
  return (
    <View style={styles.controls} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset compass to north"
        onPress={onResetNorth}
        style={control}
      >
        <Text allowFontScaling={false} style={[styles.controlText, controlText]}>
          N
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        onPress={onZoomIn}
        style={control}
      >
        <Text allowFontScaling={false} style={[styles.controlText, controlText]}>
          +
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        onPress={onZoomOut}
        style={control}
      >
        <Text allowFontScaling={false} style={[styles.controlText, controlText]}>
          −
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          camera.mode === 'follow' ? 'Following current location' : 'Recenter current location'
        }
        accessibilityState={{ disabled: recenterDisabled, selected: camera.mode === 'follow' }}
        disabled={recenterDisabled}
        onPress={onRecenter}
        style={[...control, recenterDisabled && styles.controlDisabled]}
      >
        <Text allowFontScaling={false} style={[styles.controlText, controlText]}>
          ◎
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 240, overflow: 'hidden' },
  fallback: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  fallbackOrbit: {
    borderRadius: 96,
    borderWidth: 2,
    height: 132,
    position: 'absolute',
    transform: [{ rotate: '-18deg' }],
    width: 220
  },
  fallbackTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  fallbackDetail: { fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  retry: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 18
  },
  retryText: { fontSize: 14, fontWeight: '800' },
  controls: { gap: 8, position: 'absolute', right: 12, top: 12 },
  control: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  controlDisabled: { opacity: 0.5 },
  controlText: { fontSize: 20, fontWeight: '900' },
  attribution: {
    bottom: 8,
    fontSize: assertAttributionFontSize(attributionFontSize),
    left: 8,
    lineHeight: 16,
    maxWidth: '72%',
    paddingHorizontal: 6,
    paddingVertical: 4,
    position: 'absolute'
  }
});
