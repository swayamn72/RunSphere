import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import { MapSurface } from '../maps/MapSurface';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';
import { gameWorldFor } from '../theme/game-world';
import {
  FIT_PADDING,
  FRAME_MS,
  drawFraction,
  gradientForSlice,
  paceStops,
  routeBounds,
  sliceRoute,
  type Lines
} from './route-draw-model';

/** How long the camera takes to fit the route; the line starts drawing after it. */
export const FIT_DURATION_MS = 600;

const collection = (
  geometry: Geometry | undefined
): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: 'FeatureCollection',
  features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : []
});

/**
 * A run's route on its detail map (M9 9.18): the camera fits the route, then
 * the line draws itself from start to finish, coloured by the run's own pace,
 * with a glowing tip; the start marker pops in as drawing begins and the
 * finish marker as it ends. With reduce motion the whole line and both
 * markers show at once, without a camera move.
 */
export function RunDetailMap({
  lines,
  paceSeries,
  reduceMotion,
  scheme = 'dark',
  accessibilityLabel,
  marker
}: {
  lines: Lines;
  /** `[distanceMeters, secondsPerKm]`; without it the line is one colour. */
  paceSeries?: readonly (readonly [number, number])[] | undefined;
  reduceMotion: boolean;
  /** The app theme; the route takes the day or night colours of the map under it. */
  scheme?: 'light' | 'dark';
  accessibilityLabel: string;
  /** Where the chart cursor is on the route (9.19), shown as a dot. */
  marker?: [number, number] | undefined;
}) {
  const [ready, setReady] = useState(false);
  const [fraction, setFraction] = useState(reduceMotion ? 1 : 0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const bounds = useMemo(() => routeBounds(lines), [lines]);
  const stops = useMemo(
    () =>
      paceSeries && paceSeries.length > 1
        ? paceStops(paceSeries, gameWorldFor(scheme).route.quick, gameWorldFor(scheme).route.easy)
        : undefined,
    [paceSeries, scheme]
  );

  useEffect(() => {
    if (!ready) return;
    if (reduceMotion) {
      setFraction(1);
      return;
    }
    const started = Date.now() + FIT_DURATION_MS;
    timer.current = setInterval(() => {
      const next = drawFraction(Date.now() - started);
      setFraction(next);
      if (next >= 1) clearInterval(timer.current);
    }, FRAME_MS);
    return () => clearInterval(timer.current);
  }, [ready, reduceMotion]);

  const layers = useMemo<LocalGeoJsonLayer[]>(() => {
    const slice = sliceRoute(lines, fraction);
    const first = lines.find((line) => line.length > 0)?.[0];
    const last = [...lines]
      .reverse()
      .find((line) => line.length > 0)
      ?.at(-1);
    return [
      {
        id: 'run-detail-route',
        kind: 'drawn-route',
        data: collection(
          slice.lines.length ? { type: 'MultiLineString', coordinates: slice.lines } : undefined
        ),
        ...(stops ? { gradient: gradientForSlice(stops, fraction) } : {})
      },
      {
        id: 'run-detail-start',
        kind: 'route-start',
        visible: fraction > 0,
        data: collection(first ? { type: 'Point', coordinates: [first[0], first[1]] } : undefined)
      },
      {
        id: 'run-detail-finish',
        kind: 'route-finish',
        visible: fraction >= 1,
        data: collection(last ? { type: 'Point', coordinates: [last[0], last[1]] } : undefined)
      },
      {
        id: 'run-detail-head',
        kind: 'route-head',
        visible: fraction > 0 && fraction < 1,
        data: collection(slice.head ? { type: 'Point', coordinates: slice.head } : undefined)
      },
      {
        id: 'run-detail-scrub',
        kind: 'route-head',
        visible: Boolean(marker) && fraction >= 1,
        data: collection(marker ? { type: 'Point', coordinates: marker } : undefined)
      }
    ];
  }, [lines, fraction, stops, marker]);

  return (
    <MapSurface
      accessibilityLabel={accessibilityLabel}
      localLayers={layers}
      showControls={false}
      onStyleReady={() => setReady(true)}
      {...(bounds
        ? {
            fitBounds: {
              bounds,
              padding: FIT_PADDING,
              duration: reduceMotion ? 0 : FIT_DURATION_MS
            }
          }
        : {})}
    />
  );
}
