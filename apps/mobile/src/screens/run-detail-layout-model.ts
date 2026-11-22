import type { ActivityMetrics, RunLogItem } from '@runsphere/contracts';
import { durationLabel, paceLabel } from './run-log-model';
import { sliceRoute, type Lines } from './route-draw-model';

/**
 * What the run detail shows (M9 9.19), worked out from the run log item and,
 * for your own run, its metrics. Everything here is the runner's own numbers;
 * bars and chart colours compare a run only with itself, never with anyone
 * else, and no copy judges pace (`docs/voice.md`).
 */

export interface StatCell {
  label: string;
  value: string;
}

export const statCells = (item: RunLogItem, metrics: ActivityMetrics | undefined): StatCell[] => {
  const cells: StatCell[] = [
    { label: 'Distance', value: `${(item.distanceMeters / 1_000).toFixed(2)} km` },
    {
      label: 'Moving time',
      value: durationLabel(metrics?.movingSeconds ?? item.movingSeconds ?? item.durationSeconds)
    },
    {
      label: 'Pace',
      value: paceLabel(metrics?.movingPaceSecondsPerKm ?? item.paceSecondsPerKm)
    }
  ];
  if (metrics) cells.push({ label: 'Elapsed', value: durationLabel(metrics.elapsedSeconds) });
  const climb = metrics?.elevation?.gainMeters ?? item.elevationGainMeters;
  if (climb !== null && climb !== undefined)
    cells.push({ label: 'Climb', value: `${Math.round(climb)} m` });
  const best = metrics?.splits.find((split) => split.km === metrics.fastestSplitKm);
  if (best) cells.push({ label: 'Best km', value: paceLabel(best.paceSecondsPerKm) });
  return cells;
};

export interface SplitRow {
  label: string;
  pace: string;
  climb: string | null;
  /** 0–1: how quick this km was within the run; the quickest is 1. */
  bar: number;
  fastest: boolean;
}

export const splitRows = (metrics: ActivityMetrics | undefined): SplitRow[] => {
  if (!metrics) return [];
  const paced = metrics.splits
    .map((split) => split.paceSecondsPerKm)
    .filter((pace): pace is number => pace !== null);
  const quickest = paced.length ? Math.min(...paced) : 0;
  return metrics.splits.map((split) => {
    const climb = split.elevationChangeMeters;
    const rounded = climb === null ? null : Math.round(climb);
    return {
      label: split.partial
        ? `Last ${(split.distanceMeters / 1_000).toFixed(2)} km`
        : `Km ${split.km}`,
      pace: paceLabel(split.paceSecondsPerKm),
      climb:
        rounded === null
          ? null
          : rounded > 0
            ? `+${rounded} m`
            : rounded < 0
              ? `−${-rounded} m`
              : '0 m',
      bar: split.paceSecondsPerKm ? Math.max(0.15, quickest / split.paceSecondsPerKm) : 0,
      fastest: split.km === metrics.fastestSplitKm
    };
  });
};

const EFFORT_LABEL: Record<string, string> = {
  '400m': '400 m',
  '1k': '1 km',
  '1mile': '1 mile',
  '5k': '5 km',
  '10k': '10 km',
  half: 'Half marathon'
};

export const bestEffortRows = (metrics: ActivityMetrics | undefined): StatCell[] =>
  (metrics?.bestEfforts ?? []).map((effort) => ({
    label: EFFORT_LABEL[effort.key] ?? effort.key,
    value: durationLabel(effort.seconds)
  }));

export interface ChartGeometry {
  path: string;
  /** Data range, for the cursor readout. */
  minDistance: number;
  maxDistance: number;
  minValue: number;
  maxValue: number;
}

/**
 * A series `[distance, value]` as an SVG path in `width` × `height`. Pace is
 * drawn with quicker higher (`invert`), so up always reads as "more".
 */
export const chartPath = (
  series: readonly (readonly [number, number])[],
  width: number,
  height: number,
  invert = false
): ChartGeometry | null => {
  if (series.length < 2) return null;
  const distances = series.map(([distance]) => distance);
  const values = series.map(([, value]) => value);
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spanX = maxDistance - minDistance || 1;
  const spanY = maxValue - minValue || 1;
  const pad = 4;
  const path = series
    .map(([distance, value], index) => {
      const x = ((distance - minDistance) / spanX) * width;
      const t = (value - minValue) / spanY;
      const y = pad + (invert ? t : 1 - t) * (height - pad * 2);
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return { path, minDistance, maxDistance, minValue, maxValue };
};

/** The series value nearest `distance`. */
export const valueAt = (
  series: readonly (readonly [number, number])[],
  distance: number
): number | undefined => {
  if (series.length === 0) return undefined;
  return series.reduce((best, point) =>
    Math.abs(point[0] - distance) < Math.abs(best[0] - distance) ? point : best
  )[1];
};

export interface Scrub {
  distanceMeters: number;
  label: string;
  /** Where on the route that distance is, for the dot on the map. */
  position: [number, number] | undefined;
}

/**
 * Scrubbing a chart at `x` of `width`: the distance there, what the chart
 * says, and where the runner was on the route. The route is the trimmed one,
 * so the position is found by fraction of the distance along it.
 */
export const scrubAt = (
  x: number,
  width: number,
  metrics: ActivityMetrics,
  lines: Lines,
  kind: 'pace' | 'elevation'
): Scrub => {
  const fraction = Math.min(1, Math.max(0, x / Math.max(1, width)));
  const series = kind === 'pace' ? metrics.paceSeries : metrics.elevationSeries;
  const last = series.at(-1)?.[0] ?? metrics.distanceMeters;
  const distanceMeters = fraction * last;
  const value = valueAt(series, distanceMeters);
  const reading =
    value === undefined ? '—' : kind === 'pace' ? paceLabel(value) : `${Math.round(value)} m`;
  return {
    distanceMeters,
    label: `${(distanceMeters / 1_000).toFixed(2)} km · ${reading}`,
    position: sliceRoute(lines, fraction).head
  };
};

/** At most `max` points, keeping each piece's ends, so the map draws smoothly. */
export const thinLines = (lines: Lines, max = 600): [number, number][][] => {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  const step = Math.max(1, Math.ceil(total / max));
  return lines
    .filter((line) => line.length >= 2)
    .map((line) =>
      line
        .filter((_, index) => index % step === 0 || index === line.length - 1)
        .map(([lng, lat]) => [lng, lat] as [number, number])
    );
};

/** The run's route from the detail's GeoJSON, if it has one. */
export const linesFromGeometry = (geometry: unknown): [number, number][][] | undefined => {
  if (!geometry || typeof geometry !== 'object') return undefined;
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  if (type === 'MultiLineString' && Array.isArray(coordinates))
    return coordinates as [number, number][][];
  if (type === 'LineString' && Array.isArray(coordinates))
    return [coordinates as [number, number][]];
  return undefined;
};

/** Someone else's run whose route they keep to themselves (9.20). */
export const ROUTE_HIDDEN = 'This runner keeps their route maps to themselves.';

export const DELETE_CONFIRM = 'Delete this run? It comes off your profile for good.';
export const DELETE_FAILED = "Couldn't delete this run. Check your connection and try again.";
