import { haversineMetres, type ClaimPoint } from './territory-claim.js';

/**
 * Run integrity for territory claims (Phase 5, milestone 5.2).
 *
 * Territory ownership is decided by time, so a fabricated time takes real
 * ground off a real person. This is the check that stands between the two.
 *
 * **It flags; it does not punish.** A run that looks impossible is refused a
 * *claim* and recorded for a human to look at. Nothing here suspends an account,
 * deletes an activity, or touches anybody's history — GPS is noisy, phones lie
 * about accuracy in tunnels and cities, and an automated ban on a physics
 * heuristic would eventually hit somebody honest.
 *
 * Everything is a pure function over the points, so the thresholds can be
 * argued with by reading them.
 */

export interface RunIntegrityRule {
  /**
   * Hard ceiling on instantaneous speed. The 100 m world record averages about
   * 10.4 m/s and peaks near 12.4; above this the trace is not a person running.
   */
  maxSpeedMps: number;
  /**
   * Ceiling on sustained speed across the whole loop. An elite marathon is
   * about 5.7 m/s, so this leaves generous room above any real runner while
   * still catching a bicycle.
   */
  maxSustainedSpeedMps: number;
  /** Humans do not change speed faster than this. */
  maxAccelerationMps2: number;
  /** A jump this far between consecutive fixes is a teleport, not a stride. */
  teleportMetres: number;
  /**
   * Above this, a long stretch that is almost perfectly straight and evenly
   * spaced reads as generated rather than walked. Streets bend; people weave.
   */
  straightnessCeiling: number;
  /** Straightness is only meaningful over a distance this long. */
  straightnessMinMetres: number;
}

export const DEFAULT_RUN_INTEGRITY_RULE: RunIntegrityRule = {
  maxSpeedMps: 12.5,
  maxSustainedSpeedMps: 7,
  maxAccelerationMps2: 5,
  teleportMetres: 200,
  straightnessCeiling: 0.999,
  straightnessMinMetres: 1_000
};

export type RunIntegrityFinding =
  | 'impossible_speed'
  | 'vehicle_like_pace'
  | 'impossible_acceleration'
  | 'teleport'
  | 'unnaturally_straight'
  | 'no_movement';

/**
 * `clean` claims normally. `review` claims and is recorded for a human.
 * `rejected` does not claim — the trace is not physically a run.
 *
 * The middle state is the important one: it is what stops the system choosing
 * between "ban somebody for running through a tunnel" and "let a car win".
 */
export type RunIntegrityVerdict = 'clean' | 'review' | 'rejected';

export interface RunIntegrityAssessment {
  verdict: RunIntegrityVerdict;
  findings: readonly RunIntegrityFinding[];
  /** Reported so a reviewer sees the number, not just the label. */
  peakSpeedMps: number;
  averageSpeedMps: number;
  distanceMetres: number;
  straightness: number;
}

/** Findings that mean "this was not run", rather than "this looks odd". */
const REJECTING: readonly RunIntegrityFinding[] = [
  'impossible_speed',
  'teleport',
  'unnaturally_straight'
];

/**
 * How close a path is to a straight line: displacement over path length. A
 * loop is near 0; an out-and-back is near 0; a straight drive is 1.
 */
const straightnessOf = (points: readonly ClaimPoint[], pathMetres: number): number => {
  if (points.length < 2 || pathMetres <= 0) return 0;
  const displacement = haversineMetres(points[0]!, points[points.length - 1]!);
  return displacement / pathMetres;
};

/**
 * Judge a trace on physics alone.
 *
 * Deliberately not judged: where somebody went, when, how often, or whether the
 * route resembles anyone else's. Those are the questions a surveillance system
 * asks, and none of them are needed to answer "could a person have run this".
 */
export const assessRunIntegrity = (
  points: readonly ClaimPoint[],
  rule: RunIntegrityRule = DEFAULT_RUN_INTEGRITY_RULE
): RunIntegrityAssessment => {
  const usable = points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      !Number.isNaN(point.at.getTime())
  );
  if (usable.length < 2) {
    return {
      verdict: 'clean',
      findings: [],
      peakSpeedMps: 0,
      averageSpeedMps: 0,
      distanceMetres: 0,
      straightness: 0
    };
  }

  const findings = new Set<RunIntegrityFinding>();
  let distanceMetres = 0;
  let peakSpeedMps = 0;
  let previousSpeed = 0;

  for (let index = 1; index < usable.length; index += 1) {
    const from = usable[index - 1]!;
    const to = usable[index]!;
    const metres = haversineMetres(from, to);
    const seconds = (to.at.getTime() - from.at.getTime()) / 1000;
    distanceMetres += metres;

    // A jump with no time between fixes is the classic spoof signature, and
    // dividing by it would produce Infinity rather than a finding.
    if (seconds <= 0) {
      if (metres > rule.teleportMetres) findings.add('teleport');
      continue;
    }
    if (metres > rule.teleportMetres && seconds < 5) findings.add('teleport');

    const speed = metres / seconds;
    peakSpeedMps = Math.max(peakSpeedMps, speed);
    if (speed > rule.maxSpeedMps) findings.add('impossible_speed');
    if (Math.abs(speed - previousSpeed) / seconds > rule.maxAccelerationMps2)
      findings.add('impossible_acceleration');
    previousSpeed = speed;
  }

  const totalSeconds = (usable[usable.length - 1]!.at.getTime() - usable[0]!.at.getTime()) / 1000;
  const averageSpeedMps = totalSeconds > 0 ? distanceMetres / totalSeconds : 0;
  if (averageSpeedMps > rule.maxSustainedSpeedMps) findings.add('vehicle_like_pace');
  if (distanceMetres === 0) findings.add('no_movement');

  const straightness = straightnessOf(usable, distanceMetres);
  if (distanceMetres >= rule.straightnessMinMetres && straightness > rule.straightnessCeiling)
    findings.add('unnaturally_straight');

  const list = [...findings];
  const verdict: RunIntegrityVerdict = list.some((finding) => REJECTING.includes(finding))
    ? 'rejected'
    : list.length > 0
      ? 'review'
      : 'clean';

  return { verdict, findings: list, peakSpeedMps, averageSpeedMps, distanceMetres, straightness };
};

/** What the runner is told. Never an accusation — they may simply have bad GPS. */
export const RUN_INTEGRITY_MESSAGE: Readonly<Record<RunIntegrityFinding, string>> = {
  impossible_speed:
    'This run records a speed no runner reaches, so it cannot take territory. If your GPS drifted, the run itself is still saved.',
  vehicle_like_pace:
    'This run averages faster than a person runs. It is saved, but it cannot take territory.',
  impossible_acceleration:
    'The speed in this run changes faster than a person can. It is saved and flagged for a look.',
  teleport:
    'This run jumps between distant points, which usually means the GPS lost its fix. It cannot take territory.',
  unnaturally_straight:
    'This route is too straight over too long a distance to be a run. It is saved, but it cannot take territory.',
  no_movement: 'This run did not move, so there is nothing to claim.'
};
