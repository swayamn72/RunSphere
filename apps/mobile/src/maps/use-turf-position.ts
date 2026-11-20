import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export interface TurfPosition {
  center: [number, number];
  bearing: number;
}

const previewPosition: TurfPosition = { center: [72.8777, 19.076], bearing: 35 };

export function useTurfPosition(enabled: boolean, preview: boolean) {
  const [position, setPosition] = useState<TurfPosition>();
  const [active, setActive] = useState(AppState?.currentState === 'active');
  const [permission, setPermission] = useState(false);

  useEffect(() => {
    if (!enabled || preview) return;
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, [enabled, preview]);

  useEffect(() => {
    if (!enabled || !active || preview) return;
    let current = true;
    void Location.getForegroundPermissionsAsync()
      .then((result) => {
        if (current) setPermission(result.granted);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [active, enabled, preview]);

  useEffect(() => {
    if (!enabled || !active || preview || !permission) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 },
      ({ coords, timestamp }) => {
        if (
          cancelled ||
          Date.now() - timestamp > 15_000 ||
          (coords.accuracy != null && coords.accuracy > 80)
        )
          return;
        setPosition((previous) => {
          const previousBearing = previous?.bearing ?? 0;
          const heading = coords.heading;
          const moving = (coords.speed ?? 0) >= 1 && heading != null && heading >= 0;
          const delta = moving ? ((heading - previousBearing + 540) % 360) - 180 : 0;
          return {
            center: [coords.longitude, coords.latitude],
            bearing: moving && !previous ? heading : (previousBearing + delta * 0.45 + 360) % 360
          };
        });
      }
    )
      .then((watcher) => {
        if (cancelled) watcher.remove();
        else subscription = watcher;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active, enabled, permission, preview]);

  const requestPosition = useCallback(async () => {
    if (preview) return true;
    if (!(await Location.hasServicesEnabledAsync())) return false;
    const { granted } = await Location.requestForegroundPermissionsAsync();
    setPermission(granted);
    return granted;
  }, [preview]);

  return { position: preview ? previewPosition : position, requestPosition };
}
