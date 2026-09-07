import { haversineMetres, type ClaimPoint } from './territory-claim.js';

/**
 * Ghost Race (`territory-guide.md` "Ghost Race"; `screens.md` 1.4 and LR.1).
 *
 * You tap somebody's ground, and their recorded run appears on your map as a
 * ghost that advances at the pace they actually ran it. Your trace grows
 * alongside it and a card says who is ahead.
 *
 * **It changes no rule.** `territory-guide.md` is explicit: "After the run, the
 * server applies the same carving algorithm as any other run. Ghost Race is
 * purely a motivational UI layer." Nothing in this file is read by
 * `carveOutcome`, and the claim route does not know or care whether a run was
 * made against a ghost.
 *
 * **What a ghost trace actually discloses, and what it does not.**
 * A claim already publishes its boundary, its perimeter, and its duration to
 * anybody who can see the map — so the *route* and the *average pace* are
 * public before any of this. What a ghost adds is pacing *within* the loop:
 * where the holder sped up and where they slowed. Three things bound that:
 *
 *   * **200 m is trimmed from each end** (`GHOST_TRIM_METRES`). On a loop the
 *     two ends are the same place, so this removes the arc around the point
 *     where the runner joined and left the loop — the one part of the route
 *     that tends to sit near where they live.
 *   * **A loop with nothing left after trimming has no ghost at all.** A short
 *     loop is refused rather than served in part: the alternative is publishing
 *     the very arc the trim exists to remove.
 *   * **Three views an hour, counted in the database, not in a process.** The
 *     limit is a privacy budget rather than an abuse throttle, and an in-memory
 *     counter resets on every deploy.
 */

/** `territory-guide.md`: "trimmed by 200m at both ends". */
export const GHOST_TRIM_METRES = 200;

/** `territory-guide.md`: "3 ghost trace requests per user per hour". */
export const GHOST_VIEWS_PER_HOUR = 3;

/**
 * Fewer than four points is not a route anybody can pace against, and it is
 * the same floor `detectLoopClaim` uses before it will call a trace a loop.
 */
export const GHOST_MIN_POINTS = 4;

/** One point of a ghost trace: where, and how far into the run. */
export interface GhostPoint {
  readonly latitude: number;
  readonly longitude: number;
  /** Seconds from the first point of the *trimmed* trace, so it starts at 0. */
  readonly elapsedSeconds: number;
}

export interface GhostTrace {
  readonly points: readonly GhostPoint[];
  /** Distance along the trimmed trace. Less than the claim's perimeter. */
  readonly distanceMetres: number;
  /** Time along the trimmed trace. Less than the claim's duration. */
  readonly durationSeconds: number;
  /** How much was removed from each end, so a client can say so. */
  readonly trimMetres: number;
}

export type GhostTraceRefusal = 'too_few_points' | 'too_short_to_trim' | 'no_duration';

export type GhostTraceResult =
  { readonly trace: GhostTrace } | { readonly refusal: GhostTraceRefusal };

const usable = (point: ClaimPoint): boolean =>
  Number.isFinite(point.latitude) &&
  Number.isFinite(point.longitude) &&
  Number.isFinite(point.at.getTime());

/**
 * The holder's loop, trimmed and timed.
 *
 * The loop is selected by the window `detectLoopClaim` already decided on
 * rather than by re-detecting it. Re-running the closure scan here would be a
 * second implementation of the one thing that must not disagree with the claim:
 * a ghost that raced a different loop from the one being contested would be
 * showing the wrong route to beat.
 */
export const ghostTraceFrom = (
  points: readonly ClaimPoint[],
  loop: { readonly startedAt: Date; readonly finishedAt: Date },
  trimMetres: number = GHOST_TRIM_METRES
): GhostTraceResult => {
  const from = loop.startedAt.getTime();
  const to = loop.finishedAt.getTime();
  const inLoop = points
    .filter(usable)
    .filter((point) => point.at.getTime() >= from && point.at.getTime() <= to);
  if (inLoop.length < GHOST_MIN_POINTS) return { refusal: 'too_few_points' };

  // Cumulative distance at each point, so both trims are index lookups.
  const along: number[] = [0];
  for (let index = 1; index < inLoop.length; index += 1) {
    along.push(along[index - 1]! + haversineMetres(inLoop[index - 1]!, inLoop[index]!));
  }
  const total = along[along.length - 1]!;
  if (total <= trimMetres * 2) return { refusal: 'too_short_to_trim' };

  // The first point at least `trimMetres` in, and the last at least
  // `trimMetres` from the end. Both bounds are inclusive of the point that
  // crosses them: a point exactly 200 m in is outside the trimmed arc.
  const firstKept = along.findIndex((distance) => distance >= trimMetres);
  let lastKept = along.length - 1;
  while (lastKept > firstKept && total - along[lastKept]! < trimMetres) lastKept -= 1;

  const kept = inLoop.slice(firstKept, lastKept + 1);
  if (kept.length < GHOST_MIN_POINTS) return { refusal: 'too_few_points' };

  const base = kept[0]!.at.getTime();
  const durationSeconds = Math.round((kept[kept.length - 1]!.at.getTime() - base) / 1000);
  if (durationSeconds <= 0) return { refusal: 'no_duration' };

  return {
    trace: {
      points: kept.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        elapsedSeconds: Math.max(0, Math.round((point.at.getTime() - base) / 1000))
      })),
      distanceMetres: along[lastKept]! - along[firstKept]!,
      durationSeconds,
      trimMetres
    }
  };
};

/**
 * Where the ghost is after `elapsedSeconds`, interpolated between the two
 * points it sits between.
 *
 * Interpolated rather than snapped to the nearest point, because a GPS point
 * every five seconds snapped would make the ghost jump — and a ghost that
 * jumps reads as a bug rather than as a runner.
 */
export const ghostPositionAt = (
  trace: Pick<GhostTrace, 'points'>,
  elapsedSeconds: number
): GhostPoint | undefined => {
  const points = trace.points;
  if (points.length === 0) return undefined;
  if (elapsedSeconds <= points[0]!.elapsedSeconds) return points[0];
  const last = points[points.length - 1]!;
  // Past the end the ghost has finished. It stops there rather than looping,
  // because it is a record of one run and not an animation.
  if (elapsedSeconds >= last.elapsedSeconds) return last;

  let index = 1;
  while (index < points.length - 1 && points[index]!.elapsedSeconds < elapsedSeconds) index += 1;
  const before = points[index - 1]!;
  const after = points[index]!;
  const span = after.elapsedSeconds - before.elapsedSeconds;
  const share = span > 0 ? (elapsedSeconds - before.elapsedSeconds) / span : 0;
  return {
    latitude: before.latitude + (after.latitude - before.latitude) * share,
    longitude: before.longitude + (after.longitude - before.longitude) * share,
    elapsedSeconds
  };
};

/** How far along the trimmed trace the ghost has run after `elapsedSeconds`. */
export const ghostDistanceAt = (trace: GhostTrace, elapsedSeconds: number): number => {
  const points = trace.points;
  if (points.length < 2) return 0;
  let covered = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    const leg = haversineMetres(before, after);
    if (after.elapsedSeconds <= elapsedSeconds) {
      covered += leg;
      continue;
    }
    if (before.elapsedSeconds >= elapsedSeconds) break;
    const span = after.elapsedSeconds - before.elapsedSeconds;
    covered += span > 0 ? leg * ((elapsedSeconds - before.elapsedSeconds) / span) : 0;
    break;
  }
  return Math.min(covered, trace.distanceMetres);
};

export type GhostStanding = 'ahead' | 'level' | 'behind' | 'ghost_finished';

export interface GhostComparison {
  readonly standing: GhostStanding;
  /** Seconds of advantage. Positive when ahead, negative when behind. */
  readonly secondsAhead: number;
  readonly message: string;
}

/** Inside this, the two are level. Below it the difference is GPS noise. */
export const GHOST_LEVEL_SECONDS = 5;

const plural = (seconds: number): string =>
  seconds === 1 ? '1 second' : `${Math.round(seconds)} seconds`;

/**
 * Who is ahead, compared on **distance covered**, not on elapsed time.
 *
 * The obvious comparison — your elapsed seconds against the ghost's — is
 * always a tie, because both clocks start together and run at the same rate.
 * What actually differs is how far each has got, so the question is: how long
 * did the ghost take to reach the point you have reached? The gap between that
 * and your own elapsed time is the lead.
 *
 * A runner who has gone further than the whole trimmed trace has beaten the
 * ghost outright, and is told so rather than given a growing number.
 */
export const ghostComparison = (
  trace: GhostTrace,
  yourElapsedSeconds: number,
  yourDistanceMetres: number
): GhostComparison => {
  if (yourDistanceMetres >= trace.distanceMetres && trace.distanceMetres > 0) {
    return {
      standing: 'ghost_finished',
      secondsAhead: Math.max(0, Math.round(trace.durationSeconds - yourElapsedSeconds)),
      message: 'You have covered the whole ghost route.'
    };
  }

  const ghostSecondsToHere = ghostSecondsAtDistance(trace, yourDistanceMetres);
  const secondsAhead = Math.round(ghostSecondsToHere - yourElapsedSeconds);
  if (Math.abs(secondsAhead) <= GHOST_LEVEL_SECONDS)
    return { standing: 'level', secondsAhead, message: 'Level with the ghost.' };
  if (secondsAhead > 0)
    return {
      standing: 'ahead',
      secondsAhead,
      message: `You are ${plural(secondsAhead)} ahead.`
    };
  return {
    standing: 'behind',
    secondsAhead,
    message: `You are ${plural(Math.abs(secondsAhead))} behind.`
  };
};

/** How long the ghost took to reach `metres` along the trimmed trace. */
export const ghostSecondsAtDistance = (trace: GhostTrace, metres: number): number => {
  const points = trace.points;
  if (points.length < 2 || metres <= 0) return 0;
  let covered = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    const leg = haversineMetres(before, after);
    if (covered + leg < metres) {
      covered += leg;
      continue;
    }
    const share = leg > 0 ? (metres - covered) / leg : 0;
    return before.elapsedSeconds + (after.elapsedSeconds - before.elapsedSeconds) * share;
  }
  return trace.durationSeconds;
};

/** Said on the confirmation sheet and on the live screen. Never softened. */
export const GHOST_PRIVACY_NOTE = `The route is trimmed by ${GHOST_TRIM_METRES} m at both ends, so it does not show where the run began or ended.`;

export const GHOST_RULES_NOTE =
  'A ghost changes nothing about the contest. Run the loop faster than they did and the ground is yours, whether you raced the ghost or ignored it.';

export const GHOST_UNAVAILABLE_MESSAGE: Readonly<Record<GhostTraceRefusal, string>> = {
  too_few_points: 'This run was not recorded in enough detail to race against.',
  too_short_to_trim:
    'This loop is too short to show as a ghost without revealing where it started.',
  no_duration: 'This run has no usable timing to pace a ghost against.'
};
