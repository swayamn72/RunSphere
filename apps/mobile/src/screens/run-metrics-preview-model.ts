import type { ActivityMetrics } from '@runsphere/contracts';
import { computeRunMetrics, type RunMetricsPoint } from '@runsphere/domain';
import type { LocationSample } from '../activity-recorder-core';
import type { ActivityResultPresentation } from './activity-results-model';

/**
 * The splits panel on the finish screen (M9 9.12).
 *
 * The moment a run ends, the phone works out the same metrics the server will,
 * with the same function (`computeRunMetrics`) over its own samples, so splits
 * show at once rather than after the upload. The numbers are labelled
 * "Checking…" until the server has counted the run, then replaced by the
 * server's. They are the runner's own numbers either way and never decide
 * anything (the server is authoritative, ADR-0005).
 *
 * A run that didn't count, or was deleted, shows no panel: its result is
 * settled, and splits next to "doesn't count" would read as a contradiction.
 */

export const METRICS_CHECKING_NOTE = 'Checking…';
/** A counted run from before metrics, whose numbers only the phone still has. */
export const METRICS_DEVICE_NOTE = 'From your phone';

export interface RunMetricsStat {
  label: string;
  value: string;
}

export interface RunMetricsSplitRow {
  label: string;
  pace: string;
  climb: string | null;
  fastest: boolean;
}

export interface RunMetricsPanel {
  source: 'device' | 'server';
  /** Shown under the panel; null once the server's numbers are in. */
  note: string | null;
  stats: RunMetricsStat[];
  splits: RunMetricsSplitRow[];
}

/** The samples as the server receives them: every fix, so both sides drop the same ones. */
export const metricsPointsFromSamples = (samples: readonly LocationSample[]): RunMetricsPoint[] =>
  samples.map((sample) => ({
    latitude: sample.latitude,
    longitude: sample.longitude,
    recordedAt: sample.recordedAt,
    accuracyMeters: sample.accuracy,
    altitudeMeters: sample.altitude
  }));

const two = (value: number) => Math.floor(value).toString().padStart(2, '0');

/** `00:25:00`, as the rest of the result screen shows time. */
export const clock = (seconds: number): string =>
  `${two(seconds / 3_600)}:${two((seconds / 60) % 60)}:${two(seconds % 60)}`;

/** `5:00`, minutes per km. */
export const paceClock = (secondsPerKm: number | null): string => {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm)) return '—';
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${(rounded % 60).toString().padStart(2, '0')}`;
};

const climbLabel = (metres: number | null): string | null => {
  if (metres === null) return null;
  const rounded = Math.round(metres);
  return rounded > 0 ? `+${rounded} m` : rounded < 0 ? `−${-rounded} m` : '0 m';
};

const panelFrom = (
  metrics: ActivityMetrics,
  source: RunMetricsPanel['source'],
  note: string | null
): RunMetricsPanel | null => {
  if (metrics.distanceMeters <= 0 || metrics.splits.length === 0) return null;
  const fastest = metrics.splits.find((split) => split.km === metrics.fastestSplitKm);
  const stats: RunMetricsStat[] = [{ label: 'Moving time', value: clock(metrics.movingSeconds) }];
  if (metrics.elevation)
    stats.push({ label: 'Climb', value: `${Math.round(metrics.elevation.gainMeters)} m` });
  if (fastest) stats.push({ label: 'Best km', value: paceClock(fastest.paceSecondsPerKm) });
  return {
    source,
    note,
    stats,
    splits: metrics.splits.map((split) => ({
      label: split.partial
        ? `Last ${(split.distanceMeters / 1_000).toFixed(2)} km`
        : `Km ${split.km}`,
      pace: paceClock(split.paceSecondsPerKm),
      climb: climbLabel(split.elevationChangeMeters),
      fastest: split.km === metrics.fastestSplitKm
    }))
  };
};

export const runMetricsPanel = (
  presentation: ActivityResultPresentation,
  samples: readonly LocationSample[]
): RunMetricsPanel | null => {
  if (presentation.state === 'rejected' || presentation.state === 'deleted') return null;
  if (presentation.state === 'validated' && presentation.detail.metrics)
    return panelFrom(presentation.detail.metrics, 'server', null);
  if (samples.length < 2) return null;
  const local = computeRunMetrics(metricsPointsFromSamples(samples));
  return panelFrom(
    local,
    'device',
    presentation.state === 'validated' ? METRICS_DEVICE_NOTE : METRICS_CHECKING_NOTE
  );
};
