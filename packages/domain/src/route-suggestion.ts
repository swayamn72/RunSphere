/**
 * Route suggestions: which reviewed loop to offer, and how far it should be
 * (`product.md` route suggestions; pending-work 3.1-3.3).
 *
 * The dataset is a library of loops a person reviewed and published
 * (`041_curated_routes.sql`). This file decides which of them to show, in what
 * order, and how the runner's own distance or time request changes that. It
 * never invents geometry and never touches a database.
 *
 * **Three rules constrain everything here, and all three are safety rules.**
 *
 * 1. **Pace is never a quality signal.** `product.md` says it in four separate
 *    places, and it is the load-bearing promise of the whole product: "The
 *    system never adapts by demanding faster pace." Pace appears in exactly one
 *    role below — converting a time budget into a distance, because somebody who
 *    says "I have 30 minutes" is asking a question that needs their pace to
 *    answer. It is never a score, never a ranking key, and never a target.
 *
 * 2. **A shorter suggestion is the answer to everything.** High recent load, a
 *    time request, a distance request, no history: every one of those resolves
 *    downward. There is no path through this file that suggests more than the
 *    runner asked for.
 *
 * 3. **Nothing unreviewed is ever ranked.** The caller passes published routes
 *    and this ranks them; it has no way to construct a candidate.
 */

/** The published balance numbers (`041`). */
export interface RouteSuggestionRule {
  /** `product.md`: "At most 3 route options shown at once". */
  maxSuggestions: number;
  minDistanceMetres: number;
  maxDistanceMetres: number;
  /** Where a runner with no history starts: `product.md`'s 2-4 km default. */
  newRunnerBandMetres: readonly [number, number];
  /** How far a loop may start from the runner. `product.md`: 1.5 km. */
  startWithinMetres: number;
  /** Seven-day load ratio above which the shortest option wins. */
  highLoadRatio: number;
  /** Used only to turn a time budget into a distance, for a runner with no history. */
  defaultPaceSecondsPerKm: number;
  /** How long a decline suppresses a loop. */
  declineCooldownDays: number;
}

export const DEFAULT_ROUTE_SUGGESTION_RULE: RouteSuggestionRule = {
  maxSuggestions: 3,
  minDistanceMetres: 1_000,
  maxDistanceMetres: 10_000,
  newRunnerBandMetres: [2_000, 4_000],
  startWithinMetres: 1_500,
  highLoadRatio: 1.5,
  defaultPaceSecondsPerKm: 360,
  declineCooldownDays: 30
};

/** A published loop, as the ranker sees it. Geometry stays with the caller. */
export interface CandidateRoute {
  id: string;
  /** Loops around the same ground share this; a set offers one per family. */
  familyKey: string;
  distanceMetres: number;
  /** How far the runner is from where the loop begins. */
  startDistanceMetres: number;
  surface: 'paved' | 'track' | 'trail' | 'mixed';
  lit: boolean;
  trafficExposure: 'none' | 'low' | 'moderate';
  /** When the runner last declined this loop, if they ever did. */
  declinedAt?: Date;
}

/** What the runner asked for, if anything. */
export interface SuggestionRequest {
  targetDistanceMetres?: number;
  targetMinutes?: number;
}

/**
 * What their recent running says about distance — never about speed.
 *
 * `typicalDistanceMetres` is a median rather than a mean: one 15 km Sunday
 * should not move what gets suggested on a Tuesday.
 */
export interface RunnerContext {
  typicalDistanceMetres?: number;
  /** Only ever used to answer a time budget. */
  typicalPaceSecondsPerKm?: number;
  /** Validated active minutes in the last seven days. */
  sevenDayActiveMinutes?: number;
  /** Their own trailing 28-day weekly median, which the ratio is against. */
  trailingWeeklyMedianMinutes?: number;
}

/** Whether recent load says to offer the shortest thing available. */
export const isHighLoad = (
  context: RunnerContext,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): boolean => {
  const recent = context.sevenDayActiveMinutes;
  const median = context.trailingWeeklyMedianMinutes;
  // No baseline means no comparison. Treating an unknown as high load would
  // pin every new runner to the shortest loop for their first four weeks.
  if (!(recent && recent > 0) || !(median && median > 0)) return false;
  return recent / median >= rule.highLoadRatio;
};

/** Metres a time budget buys, at their own pace or the published default. */
export const distanceForMinutes = (
  minutes: number,
  context: RunnerContext,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): number => {
  if (!(minutes > 0)) return 0;
  // Their own pace when there is one. This is the single place pace is read,
  // and it is answering their question rather than setting them a target: a
  // slower runner is offered a shorter loop for the same half hour, which is
  // the correct answer and the opposite of a pace demand.
  const pace = context.typicalPaceSecondsPerKm ?? rule.defaultPaceSecondsPerKm;
  return (minutes * 60 * 1_000) / pace;
};

/** How long a loop will take them. An estimate, and labelled as one upstream. */
export const estimatedSeconds = (
  distanceMetres: number,
  context: RunnerContext,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): number => {
  const pace = context.typicalPaceSecondsPerKm ?? rule.defaultPaceSecondsPerKm;
  return Math.round((distanceMetres / 1_000) * pace);
};

/** The distance a suggestion set aims at, and why. */
export interface DistanceTarget {
  targetMetres: number;
  reason:
    | 'you_asked_for_a_distance'
    | 'you_asked_for_a_time'
    | 'high_recent_load'
    | 'your_usual_distance'
    | 'new_runner_default';
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * What distance to aim at.
 *
 * The order is a priority order, and it is deliberate: an explicit request from
 * the runner outranks anything inferred about them. Load only overrides what
 * was *inferred*, never what was asked for — a person who types "5 km" gets
 * 5 km, because overriding a direct request in the name of their own good is
 * how an app stops being trusted.
 */
export const distanceTargetFor = (
  request: SuggestionRequest,
  context: RunnerContext,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): DistanceTarget => {
  const bounded = (metres: number): number =>
    clamp(metres, rule.minDistanceMetres, rule.maxDistanceMetres);

  if (request.targetDistanceMetres && request.targetDistanceMetres > 0) {
    return {
      targetMetres: bounded(request.targetDistanceMetres),
      reason: 'you_asked_for_a_distance'
    };
  }
  if (request.targetMinutes && request.targetMinutes > 0) {
    return {
      targetMetres: bounded(distanceForMinutes(request.targetMinutes, context, rule)),
      reason: 'you_asked_for_a_time'
    };
  }
  if (isHighLoad(context, rule)) {
    // `product.md`: "If 7-day active minutes are >=150% of the trailing 28-day
    // weekly median, prefer a shorter route suggestion."
    return { targetMetres: rule.minDistanceMetres, reason: 'high_recent_load' };
  }
  if (context.typicalDistanceMetres && context.typicalDistanceMetres > 0) {
    return {
      targetMetres: bounded(context.typicalDistanceMetres),
      reason: 'your_usual_distance'
    };
  }
  const [low, high] = rule.newRunnerBandMetres;
  return { targetMetres: bounded((low + high) / 2), reason: 'new_runner_default' };
};

/** Whether a decline still suppresses a loop. */
export const isDeclineActive = (
  candidate: CandidateRoute,
  now: Date,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): boolean => {
  if (!candidate.declinedAt) return false;
  const days = (now.getTime() - candidate.declinedAt.getTime()) / 86_400_000;
  // A decline expires rather than being permanent: "not today" is the usual
  // meaning, and a loop somebody skipped once in March should be offerable in
  // May. Negative days (a clock skew) still count as recent.
  return days < rule.declineCooldownDays;
};

/** One suggestion, ranked. */
export interface RankedRoute {
  route: CandidateRoute;
  estimatedSeconds: number;
  /** How far this is from the target distance, in metres. */
  distanceGapMetres: number;
  /** Plain words for why it is on the list. */
  reason: string;
}

/**
 * Rank published loops against a target, and take at most three.
 *
 * Ordered by how close the loop is to the target distance, then by how near it
 * starts. **Nothing here scores pace, speed, or effort** — the only comparisons
 * are distance-to-target and distance-to-runner, and both are about
 * convenience rather than performance.
 *
 * One loop per family, because three variants of the same park is one idea
 * shown three times (`map-ux.md`: "each suggestion is a different loop shape,
 * not just a scaled version of the same one").
 */
export const rankRoutes = (
  candidates: readonly CandidateRoute[],
  target: DistanceTarget,
  context: RunnerContext,
  now: Date,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): RankedRoute[] => {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.distanceMetres >= rule.minDistanceMetres &&
      candidate.distanceMetres <= rule.maxDistanceMetres &&
      candidate.startDistanceMetres <= rule.startWithinMetres &&
      !isDeclineActive(candidate, now, rule)
  );

  const ordered = [...eligible].sort((left, right) => {
    const byTarget =
      Math.abs(left.distanceMetres - target.targetMetres) -
      Math.abs(right.distanceMetres - target.targetMetres);
    if (byTarget !== 0) return byTarget;
    const byStart = left.startDistanceMetres - right.startDistanceMetres;
    if (byStart !== 0) return byStart;
    // Stable, so the same request twice gives the same three loops rather than
    // reshuffling under somebody who is deciding.
    return left.id.localeCompare(right.id);
  });

  const chosen: CandidateRoute[] = [];
  const families = new Set<string>();
  for (const candidate of ordered) {
    if (families.has(candidate.familyKey)) continue;
    families.add(candidate.familyKey);
    chosen.push(candidate);
    if (chosen.length === rule.maxSuggestions) break;
  }

  return chosen.map((route) => ({
    route,
    estimatedSeconds: estimatedSeconds(route.distanceMetres, context, rule),
    distanceGapMetres: Math.round(Math.abs(route.distanceMetres - target.targetMetres)),
    reason: routeReason(route, target)
  }));
};

/**
 * Why a loop is being offered, in words a person can argue with.
 *
 * Never a claim about their ability, and never an instruction. The most it says
 * about the runner is what they asked for.
 */
export const routeReason = (route: CandidateRoute, target: DistanceTarget): string => {
  const km = (route.distanceMetres / 1_000).toFixed(1);
  const surface = route.surface === 'mixed' ? 'mixed surface' : route.surface;
  const traffic =
    route.trafficExposure === 'none'
      ? 'away from traffic'
      : route.trafficExposure === 'low'
        ? 'mostly away from traffic'
        : 'crosses some traffic';
  const light = route.lit ? 'lit' : 'unlit';
  const opener =
    target.reason === 'high_recent_load'
      ? `A shorter ${km} km loop, because you have run a lot this week.`
      : target.reason === 'you_asked_for_a_time'
        ? `About ${km} km, which is roughly the time you asked for.`
        : `${km} km.`;
  return `${opener} ${capitalise(surface)}, ${light}, ${traffic}.`;
};

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Why there is nothing to show, when there is nothing to show. */
export type SuggestionUnavailable =
  /** No reviewed loop has been published for anywhere near here. */
  | 'no_curated_routes'
  /** There are loops nearby, but the runner has declined all of them lately. */
  | 'all_declined';

export const suggestionUnavailableReason = (
  candidates: readonly CandidateRoute[],
  ranked: readonly RankedRoute[],
  now: Date,
  rule: RouteSuggestionRule = DEFAULT_ROUTE_SUGGESTION_RULE
): SuggestionUnavailable | undefined => {
  if (ranked.length > 0) return undefined;
  const nearby = candidates.filter(
    (candidate) => candidate.startDistanceMetres <= rule.startWithinMetres
  );
  if (nearby.length === 0) return 'no_curated_routes';
  return nearby.every((candidate) => isDeclineActive(candidate, now, rule))
    ? 'all_declined'
    : 'no_curated_routes';
};

export const SUGGESTION_UNAVAILABLE_MESSAGE: Readonly<Record<SuggestionUnavailable, string>> = {
  no_curated_routes:
    'No reviewed routes near you yet. Routes are checked by a person before anyone is sent on them, so they arrive area by area. Start a free run and RunSphere will map what you do.',
  all_declined:
    'You have passed on the routes near you recently, so they are resting. Start a free run, or check back in a few weeks.'
};

/**
 * Said wherever a suggestion is shown.
 *
 * A suggestion is a guide, and the app has to say so: `map-ux.md` requires
 * "reference only ... no alerts, no penalties for going off-route", and a
 * runner who believes they are being scored against a line will run it badly.
 */
export const ROUTE_SUGGESTION_NOTE =
  'A suggestion, not a route to follow. Nothing measures how closely you stick to it, and going your own way costs nothing. Times are estimates from your own recent runs, never a target.';
