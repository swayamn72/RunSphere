import type { ActivityMetrics } from '@runsphere/contracts';
import { kolkataDate } from '@runsphere/domain';
import type { Lines } from './route-draw-model';
import { dayLabel, durationLabel, routeThumbnailPath, type RouteThumbnail } from './run-log-model';
import { paceClock } from './run-metrics-preview-model';

/**
 * The image a runner shares after a run: the route as a line on the TURFR
 * background, never over a street map, and a few of their own numbers.
 *
 * No basemap on purpose. A line alone shows the shape of a run; a line on
 * streets shows where somebody starts, and a shared image is public for good.
 * The route is the one the server returns, so privacy zones and the runner's
 * own "Hide start and finish" still apply to it.
 */

/** Drawn at this size in points, captured at three times for a 1080 × 1350 image. */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 450;
export const SHARE_IMAGE_SCALE = 3;
/** The square the route is fitted into, in card points. */
export const SHARE_ROUTE_SIZE = 240;

export interface RunShareStat {
  label: string;
  value: string;
}

export interface RunShareCard {
  title: string;
  dateLabel: string;
  stats: RunShareStat[];
  route: RouteThumbnail | null;
  /** Read out for the preview, and the share sheet's text where an app takes text too. */
  summary: string;
}

/** "Morning run", from the hour the run started in India time (ADR-0006). */
export const runTitle = (startedAt: string): string => {
  const local = new Date(Date.parse(startedAt) + 330 * 60_000);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (hour >= 4 && hour < 12) return 'Morning run';
  if (hour >= 12 && hour < 17) return 'Afternoon run';
  if (hour >= 17 && hour < 21) return 'Evening run';
  return 'Night run';
};

export const runShareCard = (input: {
  metrics: Pick<ActivityMetrics, 'distanceMeters' | 'elapsedSeconds' | 'movingPaceSecondsPerKm'> & {
    elevation: { gainMeters: number } | null;
  };
  /** When it started; a run from the log may only know its day. */
  startedAt?: string | undefined;
  /** `YYYY-MM-DD` in India, used when there is no start time. */
  startedOn?: string | undefined;
  lines: Lines | null | undefined;
}): RunShareCard | null => {
  const { metrics, startedAt, startedOn, lines } = input;
  const timed = startedAt !== undefined && Number.isFinite(Date.parse(startedAt));
  const day = timed ? kolkataDate(new Date(startedAt)) : startedOn;
  if (metrics.distanceMeters <= 0 || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const distance = `${(metrics.distanceMeters / 1_000).toFixed(2)} km`;
  const time = durationLabel(metrics.elapsedSeconds);
  const pace = `${paceClock(metrics.movingPaceSecondsPerKm)} /km`;
  const stats: RunShareStat[] = [
    { label: 'Distance', value: distance },
    { label: 'Elapsed time', value: time },
    { label: 'Pace', value: pace }
  ];
  const climb = metrics.elevation ? Math.round(metrics.elevation.gainMeters) : 0;
  if (climb > 0) stats.push({ label: 'Climb', value: `${climb} m` });
  return {
    title: timed ? runTitle(startedAt) : 'Run',
    dateLabel: dayLabel(day),
    stats,
    route: routeThumbnailPath(lines, SHARE_ROUTE_SIZE, 16),
    summary: `${distance} in ${time} on TURFR.`
  };
};
