export type MapLifecycleState =
  'loading' | 'ready' | 'offline' | 'style-error' | 'tile-error' | 'fallback';

export type MapCameraMode = 'follow' | 'free-pan';
export type MapSheetState = 'collapsed' | 'half' | 'expanded' | 'list';

export interface MapCameraState {
  readonly mode: MapCameraMode;
  readonly zoom: number;
  readonly bearing: number;
}

export const initialMapCameraState: MapCameraState = { mode: 'free-pan', zoom: 12, bearing: 0 };

export const applyNativeCameraState = (
  camera: MapCameraState,
  viewState: Pick<MapCameraState, 'zoom' | 'bearing'>,
  userInteraction: boolean
): MapCameraState => ({
  mode: userInteraction ? 'free-pan' : camera.mode,
  zoom: viewState.zoom,
  bearing: viewState.bearing
});

export const transitionMapLifecycle = (
  current: MapLifecycleState,
  event:
    | 'style-loaded'
    | 'offline'
    | 'style-failed'
    | 'tile-failed'
    | 'retry'
    | 'background'
    | 'foreground'
): MapLifecycleState => {
  if (event === 'offline') return 'offline';
  if (event === 'style-failed') return 'style-error';
  if (event === 'tile-failed') return 'tile-error';
  if (event === 'retry' || event === 'foreground') return 'loading';
  if (event === 'background') return current === 'loading' ? 'fallback' : current;
  return 'ready';
};

export const enterFreePan = (camera: MapCameraState): MapCameraState => ({
  ...camera,
  mode: 'free-pan'
});

export const recenterMap = (camera: MapCameraState): MapCameraState => ({
  ...camera,
  mode: 'follow'
});

export const resetCompass = (camera: MapCameraState): MapCameraState => ({ ...camera, bearing: 0 });

/** Reduced motion keeps camera updates immediate without changing follow state. */
export const shouldAnimateCamera = (reduceMotion: boolean): boolean => !reduceMotion;

export const adjustMapZoom = (camera: MapCameraState, amount: number): MapCameraState => ({
  ...camera,
  zoom: Math.max(1, Math.min(22, camera.zoom + amount))
});

export const resolveSheetState = (
  state: MapSheetState,
  action: 'collapse' | 'expand' | 'show-list'
): MapSheetState => {
  if (action === 'show-list') return 'list';
  if (action === 'collapse') return 'collapsed';
  if (state === 'collapsed') return 'half';
  return 'expanded';
};

export const attributionFontSize = 12;
export const assertAttributionFontSize = (fontSize: number): number => {
  if (fontSize < attributionFontSize) throw new Error('Map attribution must be at least 12sp.');
  return fontSize;
};

/** Bounds renderer work without changing the stored local trace. */
export const decimateCoordinates = <T>(coordinates: readonly T[], maximum = 500): readonly T[] => {
  if (coordinates.length <= maximum) return coordinates;
  const stride = Math.ceil(coordinates.length / maximum);
  const sampled = coordinates.filter((_, index) => index % stride === 0);
  const finalCoordinate = coordinates.at(-1);
  if (finalCoordinate !== undefined && sampled.at(-1) !== finalCoordinate)
    sampled.push(finalCoordinate);
  return sampled;
};
