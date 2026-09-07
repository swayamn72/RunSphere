import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { GhostTraceResponse, GhostTraceUnavailable } from '@runsphere/contracts';
import {
  GHOST_TRIM_METRES,
  ghostComparison,
  ghostPositionAt,
  type GhostStanding,
  type GhostTrace
} from '@runsphere/domain';
import { AuthFailure, type AuthFailureKind } from '../auth-failure';
import { ApiFailure } from '../api-client';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';

/**
 * Ghost Race on the phone (`screens.md` 1.4 and LR.1).
 *
 * The arithmetic lives in `@runsphere/domain` (`ghost-race.ts`) because the
 * server builds traces with it and the client reads them with it, and a ghost
 * that advanced differently on each side would be a different race. This file
 * is the presentation: what the map draws, and what the card says.
 *
 * **The ghost is a record, not an opponent.** It does not react, it cannot be
 * caught out, and beating it changes nothing about the contest — the loop is
 * won on time either way (`GHOST_RULES_NOTE`). Everything here is worded to
 * keep that clear, because a UI that treats a stored trace as a live rival is
 * a UI that will eventually be blamed for one.
 */

export type GhostState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'rate-limited'
  | 'offline'
  | 'error'
  | 'session-expired';

/** The trace as the domain wants it, from the shape the wire carries. */
export const ghostTraceFromResponse = (response: GhostTraceResponse): GhostTrace => ({
  points: response.points.map((point) => ({
    longitude: point.at[0],
    latitude: point.at[1],
    elapsedSeconds: point.elapsedSeconds
  })),
  distanceMetres: response.distanceMetres,
  durationSeconds: response.durationSeconds,
  trimMetres: response.trimMetres
});

/**
 * What survives into the run.
 *
 * The notes travel with it rather than being re-derived on the live screen: a
 * runner who accepted a ghost after reading what was trimmed should be able to
 * see the same sentence mid-run without the app having to remember which
 * version of the rule it fetched under.
 */
export interface GhostRun {
  readonly claimId: string;
  readonly holderName: string;
  readonly trace: GhostTrace;
  readonly privacyNote: string;
  readonly rulesNote: string;
}

export const ghostRunFrom = (response: GhostTraceResponse): GhostRun => ({
  claimId: response.claimId,
  holderName: response.owner.displayName,
  trace: ghostTraceFromResponse(response),
  privacyNote: response.privacyNote,
  rulesNote: response.rulesNote
});

const NETWORK_KINDS: readonly AuthFailureKind[] = ['network', 'tls'];

export const ghostErrorState = (error: unknown): GhostState => {
  if (error instanceof AuthFailure) {
    if (NETWORK_KINDS.includes(error.kind)) return 'offline';
    if (error.kind === 'invalid-credentials') return 'session-expired';
    return 'error';
  }
  if (error instanceof ApiFailure) {
    // 429 is its own state, not an error: nothing is wrong, and the runner can
    // still start the run without a ghost.
    if (error.status === 429) return 'rate-limited';
    if (error.status === 403 || error.status === 404) return 'unavailable';
    return 'error';
  }
  return 'error';
};

/** Words for a refusal the server explained, so no screen prints a code. */
export const GHOST_REFUSAL_MESSAGE: Readonly<Record<GhostTraceUnavailable['reason'], string>> = {
  no_trace: 'This run cannot be shown as a ghost. You can still run the loop and take the ground.',
  own_claim: 'This is your own ground. There is no ghost to race.',
  not_held: 'Nobody holds this ground right now, so there is nothing to race.',
  out_of_region: 'Ghost races are limited to places you have run in this season.',
  rate_limited: 'You have used your ghost races for this hour. The run does not need one.'
};

export const ghostStateMessage = (state: GhostState): string => {
  if (state === 'loading') return 'Loading the ghost.';
  if (state === 'rate-limited') return GHOST_REFUSAL_MESSAGE.rate_limited;
  if (state === 'unavailable') return GHOST_REFUSAL_MESSAGE.no_trace;
  if (state === 'offline')
    return 'RunSphere could not reach the service. You can still run the loop.';
  if (state === 'error') return 'The ghost could not be loaded. You can still run the loop.';
  return '';
};

/**
 * The two ghost layers at `elapsedSeconds` into the run: the part of the route
 * the holder had covered by now, and where they were.
 *
 * The line grows rather than being drawn whole, which is the difference
 * between a ghost and a route guide: a guide shows where you *could* go, a
 * ghost shows where somebody already was at this point in their run.
 *
 * Returned before the live trace layers so the runner's own line draws on top.
 */
export const ghostLayers = (
  run: GhostRun | undefined,
  elapsedSeconds: number
): readonly LocalGeoJsonLayer[] => {
  if (!run) return [];
  const covered: Position[] = run.trace.points
    .filter((point) => point.elapsedSeconds <= elapsedSeconds)
    .map((point) => [point.longitude, point.latitude]);
  const head = ghostPositionAt(run.trace, elapsedSeconds);
  if (!head) return [];
  // The interpolated head is where the ghost actually is, so the line ends
  // there rather than at the last whole point it passed — unless the ghost is
  // sitting exactly on that point, which it is at the start of the run. Adding
  // it anyway would make a two-vertex line with both vertices in the same
  // place, and a zero-length line is a rendering artefact, not a route.
  const last = covered[covered.length - 1];
  const headIsNew =
    !last ||
    Math.abs(last[0]! - head.longitude) > 1e-9 ||
    Math.abs(last[1]! - head.latitude) > 1e-9;
  const line: Position[] = headIsNew ? [...covered, [head.longitude, head.latitude]] : [...covered];

  const layers: LocalGeoJsonLayer[] = [];
  if (line.length >= 2) {
    layers.push({
      id: 'ghost-trace',
      kind: 'ghost',
      data: collection({ type: 'LineString', coordinates: line })
    });
  }
  layers.push({
    id: 'ghost-head',
    kind: 'ghost-head',
    data: collection({ type: 'Point', coordinates: [head.longitude, head.latitude] })
  });
  return layers;
};

/** The whole ghost route, for the confirmation sheet's preview map. */
export const ghostPreviewLayers = (run: GhostRun): readonly LocalGeoJsonLayer[] => [
  {
    id: 'ghost-preview',
    kind: 'ghost',
    data: collection({
      type: 'LineString',
      coordinates: run.trace.points.map((point) => [point.longitude, point.latitude])
    })
  }
];

const collection = (geometry: Geometry): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry }]
});

export interface GhostCard {
  readonly headline: string;
  readonly detail: string;
  readonly standing: GhostStanding;
  /** Which status colour the card takes. Green ahead, amber level, red behind. */
  readonly tone: 'success' | 'warning' | 'error' | 'info';
  readonly accessibilityLabel: string;
}

const TONE: Readonly<Record<GhostStanding, GhostCard['tone']>> = {
  ahead: 'success',
  level: 'warning',
  behind: 'error',
  ghost_finished: 'info'
};

const clock = (seconds: number): string =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, '0')}`;

/**
 * The live comparison card (`screens.md` LR.1).
 *
 * The spec's example is `You: 4:12 elapsed   Ghost: 4:31 elapsed`, which reads
 * as two clocks. They are not two clocks — both started together and both read
 * the same. What the second number actually is, is how long the *ghost* took to
 * reach the point the runner has reached, so it is labelled that way.
 */
export const ghostCard = (
  run: GhostRun,
  yourElapsedSeconds: number,
  yourDistanceMetres: number
): GhostCard => {
  const comparison = ghostComparison(run.trace, yourElapsedSeconds, yourDistanceMetres);
  const ghostSeconds = yourElapsedSeconds + comparison.secondsAhead;
  const detail =
    comparison.standing === 'ghost_finished'
      ? `${run.holderName} finished this route in ${clock(run.trace.durationSeconds)}.`
      : `You ${clock(yourElapsedSeconds)} · ${run.holderName} reached here in ${clock(ghostSeconds)}`;
  return {
    headline: comparison.message,
    detail,
    standing: comparison.standing,
    tone: TONE[comparison.standing],
    accessibilityLabel: `${comparison.message} ${detail}`
  };
};

/** What the confirmation sheet says before anybody commits (`screens.md` 1.4). */
export interface GhostConfirmation {
  readonly title: string;
  readonly pace: string;
  readonly recorded: string;
  readonly privacyNote: string;
  readonly rulesNote: string;
}

export const ghostConfirmation = (response: GhostTraceResponse): GhostConfirmation => ({
  title: `Race ${response.owner.displayName}'s ghost`,
  pace: `${response.owner.displayName} covered ${(response.distanceMetres / 1_000).toFixed(1)} km of this loop in ${clock(response.durationSeconds)}.`,
  // Date only, and said plainly: a three-week-old ghost is a different
  // proposition from yesterday's, and the sheet should not hide which it is.
  recorded: `Recorded on ${response.recordedOn}.`,
  privacyNote: response.privacyNote,
  rulesNote: response.rulesNote
});

/**
 * Said next to the button, always. The trim is the one thing a holder is
 * trusting the app about, so it is stated where the *challenger* sees it too.
 */
export const GHOST_TRIM_SUMMARY = `Trimmed by ${GHOST_TRIM_METRES} m at both ends.`;
