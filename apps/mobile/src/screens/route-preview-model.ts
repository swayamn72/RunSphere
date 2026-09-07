import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { RouteSuggestion, RouteSuggestionResponse } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';

/**
 * The route preview screen, as arithmetic (`map-ux.md` section 2;
 * `screens.md` 3.1).
 *
 * Three rules this file exists to keep, all of them from `041_curated_routes.sql`
 * and `route-suggestion.ts`, and none of them enforceable inside a component:
 *
 *   * **A suggestion is a reference, never an instruction.** Every string here
 *     that names a time says it is an estimate, and the guide line on the live
 *     map is painted differently from the trace on purpose.
 *   * **A size label has to be true.** Calling the shortest of three 4 km loops
 *     "Short" is a lie the runner finds out about a kilometre in, so the labels
 *     appear only when the loops are far enough apart to deserve them.
 *   * **The screen never invents a distance.** Adjusting asks the server again;
 *     it does not scale the loop it already has. Scaling a reviewed loop
 *     produces an unreviewed one.
 */

/** 1-10 km, from the published rule (`041`). */
export const MIN_TARGET_METRES = 1_000;
export const MAX_TARGET_METRES = 10_000;
/** What one press of + or - moves. Half a kilometre is a legible increment. */
export const TARGET_STEP_METRES = 500;

/**
 * How far apart the shortest and longest have to be before Short/Medium/Long
 * means anything. Below this they are three shapes of the same run, and the
 * distance printed on each card is the honest way to tell them apart.
 */
export const SIZE_LABEL_MIN_SPREAD_METRES = 800;

export type RoutePreviewState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'error'
  | 'configuration'
  | 'session-expired';

export interface RoutePreviewCard {
  readonly suggestion: RouteSuggestion;
  /** Absent when the set is too tightly bunched for a size word to be true. */
  readonly sizeLabel?: string;
  readonly distanceLabel: string;
  readonly estimateLabel: string;
  readonly startLabel: string;
  readonly facts: readonly string[];
}

export const routePreviewErrorStateFor = (
  error: unknown
): Extract<RoutePreviewState, 'offline' | 'error' | 'configuration' | 'session-expired'> => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  return 'error';
};

export const formatRouteDistance = (metres: number): string =>
  `${(metres / 1_000).toFixed(metres % 1_000 === 0 ? 0 : 1)} km`;

/**
 * Always hedged. `RouteSuggestionSchema` requires the app to present this as an
 * estimate, and a tilde alone is too quiet to carry that.
 */
export const formatRouteEstimate = (seconds: number): string =>
  `About ${Math.max(1, Math.round(seconds / 60))} min`;

export const formatStartDistance = (metres: number): string =>
  metres < 100
    ? 'Starts where you are'
    : metres < 1_000
      ? `Starts ${Math.round(metres / 10) * 10} m away`
      : `Starts ${(metres / 1_000).toFixed(1)} km away`;

const SURFACE_WORDS: Record<RouteSuggestion['surface'], string> = {
  paved: 'Paved',
  track: 'Running track',
  trail: 'Trail',
  mixed: 'Mixed surface'
};

const TRAFFIC_WORDS: Record<RouteSuggestion['trafficExposure'], string> = {
  none: 'No traffic',
  low: 'Little traffic',
  moderate: 'Some traffic'
};

const ACCESS_WORDS: Record<RouteSuggestion['accessibility'], string> = {
  'step-free': 'Step-free',
  mixed: 'Some steps',
  unknown: 'Steps unknown'
};

/**
 * What a reviewer had to have an opinion on, in the order somebody deciding
 * whether to run there after dark would want it. Lighting is first for that
 * reason, and an unlit route says so rather than staying quiet.
 */
export const routeFacts = (suggestion: RouteSuggestion): readonly string[] => [
  suggestion.lit ? 'Lit' : 'Unlit',
  SURFACE_WORDS[suggestion.surface],
  TRAFFIC_WORDS[suggestion.trafficExposure],
  ACCESS_WORDS[suggestion.accessibility]
];

const sizeWordsFor = (count: number): readonly string[] =>
  count === 3 ? ['Short', 'Medium', 'Long'] : count === 2 ? ['Shorter', 'Longer'] : [];

/**
 * Cards in ascending distance, which is the order the size words assume.
 * Ties keep server order, so a reload does not reshuffle the carousel.
 */
export const routePreviewCards = (
  suggestions: readonly RouteSuggestion[]
): readonly RoutePreviewCard[] => {
  const sorted = suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) =>
      a.suggestion.distanceMetres === b.suggestion.distanceMetres
        ? a.index - b.index
        : a.suggestion.distanceMetres - b.suggestion.distanceMetres
    )
    .map((entry) => entry.suggestion);

  const spread = sorted.length
    ? sorted[sorted.length - 1]!.distanceMetres - sorted[0]!.distanceMetres
    : 0;
  const words = spread >= SIZE_LABEL_MIN_SPREAD_METRES ? sizeWordsFor(sorted.length) : [];

  return sorted.map((suggestion, index) => {
    const sizeLabel = words[index];
    return {
      suggestion,
      ...(sizeLabel ? { sizeLabel } : {}),
      distanceLabel: formatRouteDistance(suggestion.distanceMetres),
      estimateLabel: formatRouteEstimate(suggestion.estimatedSeconds),
      startLabel: formatStartDistance(suggestion.startDistanceMetres),
      facts: routeFacts(suggestion)
    };
  });
};

export const routePreviewStateFor = (response: RouteSuggestionResponse): RoutePreviewState =>
  response.data.length ? 'ready' : 'empty';

export const clampSelectedIndex = (count: number, index: number): number =>
  count <= 0 ? 0 : Math.min(Math.max(0, index), count - 1);

export const clampTargetMetres = (metres: number): number =>
  Math.min(MAX_TARGET_METRES, Math.max(MIN_TARGET_METRES, metres));

/**
 * Rounds toward the direction pressed, so a target the server chose - 3,847 m
 * because that is what somebody usually runs - becomes 4,000 up and 3,500 down
 * rather than a step off an odd number.
 */
export const stepTargetMetres = (current: number, direction: 'up' | 'down'): number => {
  const steps = current / TARGET_STEP_METRES;
  const next =
    direction === 'up'
      ? (Math.floor(steps) + 1) * TARGET_STEP_METRES
      : (Math.ceil(steps) - 1) * TARGET_STEP_METRES;
  return clampTargetMetres(next);
};

export const canStepTarget = (current: number, direction: 'up' | 'down'): boolean =>
  stepTargetMetres(current, direction) !== clampTargetMetres(current);

/**
 * "I have [ ] minutes". Refuses rather than guesses: the contract accepts
 * 1-600, and silently clamping 9,000 to 600 would show somebody a 10 km loop
 * they did not ask for.
 */
export const parseMinutesInput = (
  text: string
): { readonly minutes: number } | { readonly error: string } => {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Enter how many minutes you have.' };
  if (!/^\d{1,4}$/.test(trimmed)) return { error: 'Enter minutes as a whole number.' };
  const minutes = Number(trimmed);
  if (minutes < 1 || minutes > 600) return { error: 'Enter between 1 and 600 minutes.' };
  return { minutes };
};

const TARGET_REASONS: Record<
  RouteSuggestionResponse['targetReason'],
  (distance: string) => string
> = {
  you_asked_for_a_distance: (distance) => `Around ${distance}, as you asked.`,
  you_asked_for_a_time: (distance) => `Around ${distance} in the time you have.`,
  // The one case where the answer is deliberately shorter than usual, and the
  // only one the runner would otherwise find inexplicable.
  high_recent_load: (distance) =>
    `You have run a lot this week, so these are shorter - around ${distance}.`,
  your_usual_distance: (distance) => `Around ${distance}, close to your usual.`,
  new_runner_default: (distance) => `Starting around ${distance}. Adjust it to suit you.`
};

export const targetReasonMessage = (response: RouteSuggestionResponse): string =>
  TARGET_REASONS[response.targetReason](formatRouteDistance(response.targetDistanceMetres));

/**
 * Distinguishes "nobody has published anything near you" from "you have passed
 * on everything near you", because only the second one is about the runner.
 */
export const unavailableMessage = (response: RouteSuggestionResponse): string =>
  response.unavailableReason === 'all_declined'
    ? 'You have passed on the routes near you recently. They come back around, or you can start without one.'
    : 'No reviewed routes near you yet. Start without one - your run counts the same.';

/**
 * What survives from the preview screen into the run: enough to draw the line
 * and to report a completion against it, and nothing else. Not the whole
 * suggestion, because the estimate and the reason are about a decision that has
 * already been made.
 */
export interface RouteGuide {
  readonly routeId: string;
  readonly name: string;
  readonly distanceMetres: number;
  readonly path: RouteSuggestion['path'];
}

export const routeGuideFrom = (suggestion: RouteSuggestion): RouteGuide => ({
  routeId: suggestion.id,
  name: suggestion.name,
  distanceMetres: suggestion.distanceMetres,
  path: suggestion.path
});

/**
 * `CoordinateSchema` is already `[longitude, latitude]` - GeoJSON order - so
 * this copies rather than converts. Written out anyway: a tuple that silently
 * changed order would put every route in the wrong hemisphere, and a `map` here
 * is where a reader looks for that.
 */
const ring = (path: RouteSuggestion['path']): Position[] =>
  path.map(([longitude, latitude]) => [longitude, latitude]);

const featureCollection = (geometry: Geometry): FeatureCollection<Geometry, GeoJsonProperties> => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry }]
});

/**
 * The preview map, where the loop is the subject of the screen and so is drawn
 * solid. On the live map the same loop becomes a `guide` instead - see
 * `routeGuideLayers`.
 */
export const routePreviewLayers = (suggestion: RouteSuggestion): readonly LocalGeoJsonLayer[] => [
  {
    id: 'route-preview-loop',
    kind: 'line',
    data: featureCollection({ type: 'LineString', coordinates: ring(suggestion.path) })
  },
  {
    id: 'route-preview-start',
    kind: 'circle',
    data: featureCollection({
      type: 'Point',
      coordinates: [suggestion.start[0], suggestion.start[1]]
    })
  }
];

/**
 * The accepted route on the live map (`map-ux.md` 1.5): dashed, translucent,
 * and **static from the first frame to the last**. It does not advance, tick
 * off, or turn green behind the runner, because none of those are things a
 * reference does - they are things a course does.
 *
 * Returned ahead of the trace layers so it draws beneath them.
 */
export const routeGuideLayers = (guide: RouteGuide | undefined): readonly LocalGeoJsonLayer[] =>
  guide
    ? [
        {
          id: 'route-guide',
          kind: 'guide',
          data: featureCollection({ type: 'LineString', coordinates: ring(guide.path) })
        }
      ]
    : [];

/** Centres the preview on the loop, not on the runner. */
export const loopCentre = (suggestion: RouteSuggestion): readonly [number, number] | undefined => {
  if (!suggestion.path.length) return undefined;
  const longitudes = suggestion.path.map(([longitude]) => longitude);
  const latitudes = suggestion.path.map(([, latitude]) => latitude);
  return [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2
  ];
};

/** Said on the live screen, so the line's status is never ambiguous. */
export const ROUTE_GUIDE_CAPTION = 'Route guide - a reference, not a course. Run where you like.';
