/**
 * Smart territory recommendation (Phase 5, milestone 5.3).
 *
 * "Which of these could I realistically take today?"
 *
 * **This is a calibrated heuristic, not a trained model, and it says so.** It
 * fits a runner's own recent history — their usual distance and their usual
 * pace — and compares that against the time a holder set. That is a real
 * statistical question with a defensible answer; dressing it up as machine
 * learning would add a dependency, a training pipeline, and a story, and would
 * not make the number better. The seam is here for a model to replace
 * `estimateSeconds` and `successProbability` when there is enough data to train
 * one and a reason to.
 *
 * Two rules constrain what may be suggested, and both are safety rules
 * (`product.md`, ADR-0011):
 *
 * - **Never beyond ability.** A recommendation is a nudge from an app somebody
 *   trusts; pointing a 3 km runner at a 12 km loop is how people get hurt.
 * - **Never a certainty.** Output is an estimate with the sample size attached,
 *   so a person can weigh it rather than obey it.
 */

/** One finished run, reduced to the two numbers ability is read from. */
export interface PastRun {
  distanceMetres: number;
  durationSeconds: number;
}

export interface RunnerAbility {
  /** Median rather than mean: one marathon should not redefine a 5 k runner. */
  typicalDistanceMetres: number;
  typicalPaceSecondsPerKm: number;
  bestPaceSecondsPerKm: number;
  /** How many runs this was read from. Published so nobody over-reads it. */
  runsConsidered: number;
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

/** Below this there is not enough history to say anything honest. */
export const MINIMUM_RUNS_FOR_ADVICE = 3;

/**
 * What this runner usually does. `undefined` when there is too little history —
 * an estimate from one run is a guess wearing a percentage sign.
 */
export const abilityFrom = (runs: readonly PastRun[]): RunnerAbility | undefined => {
  const usable = runs.filter(
    (run) =>
      Number.isFinite(run.distanceMetres) &&
      Number.isFinite(run.durationSeconds) &&
      run.distanceMetres >= 500 &&
      run.durationSeconds > 0
  );
  if (usable.length < MINIMUM_RUNS_FOR_ADVICE) return undefined;

  const paces = usable.map((run) => run.durationSeconds / (run.distanceMetres / 1000));
  return {
    typicalDistanceMetres: median(usable.map((run) => run.distanceMetres)),
    typicalPaceSecondsPerKm: median(paces),
    bestPaceSecondsPerKm: Math.min(...paces),
    runsConsidered: usable.length
  };
};

/**
 * How efficiently a loop encloses ground: the isoperimetric quotient,
 * `4piA / P^2`. A perfect circle is 1; a long thin out-and-back approaches 0.
 *
 * This is the honest half of "best capture route". It answers **which existing
 * loop gives the most ground for the least running**, which is a real question
 * with an exact answer from data already held.
 *
 * It deliberately does **not** propose a new route. Doing that needs a map of
 * runnable ground — pavements, crossings, which roads are safe after dark — and
 * this deployment has none: Valhalla sits in the compose file with no tiles, and
 * there is no eligibility dataset. A generated line across a motorway would be
 * worse than no suggestion at all, so the app suggests loops people have
 * demonstrably run instead of inventing ones nobody has.
 */
export const loopEfficiency = (areaSqm: number, perimeterMetres: number): number => {
  if (perimeterMetres <= 0 || areaSqm <= 0) return 0;
  return Math.min(1, (4 * Math.PI * areaSqm) / perimeterMetres ** 2);
};

/** A territory that could be attempted, as the recommender sees it. */
export interface CandidateTerritory {
  claimId: string;
  /** Distance of the loop that holds it — what a challenger has to run. */
  perimeterMetres: number;
  /** The time to beat. */
  holderDurationSeconds: number;
  areaSqm: number;
  /** The reader's own ground is defended, not captured. */
  isSelf: boolean;
}

export type CaptureDifficulty = 'comfortable' | 'stretch' | 'beyond-reach';

export interface TerritoryRecommendation {
  claimId: string;
  distanceMetres: number;
  areaSqm: number;
  /** The time to beat. */
  targetSeconds: number;
  /** What this runner would likely take, at their own usual pace. */
  estimatedSeconds: number;
  /** 0–1. An estimate, and the app must present it as one. */
  successProbability: number;
  difficulty: CaptureDifficulty;
  /** Ground per metre run, 0–1. A circle is 1; a thin loop approaches 0. */
  efficiency: number;
  /** Plain-language reason, so the suggestion can be argued with. */
  reason: string;
}

/**
 * How far past the usual distance a suggestion may reach. Past this the loop is
 * not a stretch, it is a different kind of run, and the app should not be the
 * thing that talks somebody into it.
 */
export const MAX_STRETCH_FACTOR = 1.5;

/** Time at a given pace, in seconds. */
const secondsFor = (distanceMetres: number, paceSecondsPerKm: number): number =>
  Math.round((distanceMetres / 1000) * paceSecondsPerKm);

/**
 * Probability that this runner beats the holder's time.
 *
 * A logistic on the margin between the time they would likely take and the time
 * they need, scaled by how big the target is — being 60 seconds off matters more
 * on a 10-minute loop than on an hour one. Then damped by sample size, because a
 * confident number from four runs is a lie told precisely.
 */
export const successProbability = (
  estimatedSeconds: number,
  targetSeconds: number,
  runsConsidered: number
): number => {
  if (targetSeconds <= 0) return 0;
  const margin = (targetSeconds - estimatedSeconds) / targetSeconds;
  const raw = 1 / (1 + Math.exp(-margin * 8));
  // With little history, pull towards "no idea" rather than towards optimism.
  const confidence = Math.min(1, runsConsidered / 10);
  const damped = 0.5 + (raw - 0.5) * confidence;
  return Math.round(Math.min(0.95, Math.max(0.05, damped)) * 100) / 100;
};

const difficultyFor = (distanceMetres: number, ability: RunnerAbility): CaptureDifficulty => {
  const ratio = distanceMetres / Math.max(1, ability.typicalDistanceMetres);
  if (ratio > MAX_STRETCH_FACTOR) return 'beyond-reach';
  return ratio > 1.1 ? 'stretch' : 'comfortable';
};

const reasonFor = (
  recommendation: Omit<TerritoryRecommendation, 'reason'>,
  ability: RunnerAbility
): string => {
  const km = (recommendation.distanceMetres / 1000).toFixed(1);
  const percent = Math.round(recommendation.successProbability * 100);
  const usualKm = (ability.typicalDistanceMetres / 1000).toFixed(1);
  return recommendation.difficulty === 'comfortable'
    ? `${km} km, about the ${usualKm} km you usually run. At your usual pace you would finish around the holder's time — roughly a ${percent}% chance on your recent runs.`
    : `${km} km, longer than your usual ${usualKm} km. Roughly a ${percent}% chance on your recent runs, and it would be your longest in a while.`;
};

/**
 * Up to `limit` territories worth attempting, best chance first.
 *
 * Deliberately excluded: the reader's own ground (that is defending, a different
 * screen), and anything past `MAX_STRETCH_FACTOR` of their usual distance.
 * Nothing here reads where somebody lives, what time they run, or who they run
 * near — distance and pace are the whole of the input.
 */
export const recommendCaptures = (
  ability: RunnerAbility | undefined,
  candidates: readonly CandidateTerritory[],
  limit = 3
): TerritoryRecommendation[] => {
  if (!ability) return [];
  return (
    candidates
      .filter((candidate) => !candidate.isSelf && candidate.perimeterMetres > 0)
      .flatMap((candidate) => {
        const difficulty = difficultyFor(candidate.perimeterMetres, ability);
        // Not "unlikely" — out of scope. The app does not talk anybody into a
        // run half again as long as anything they have done.
        if (difficulty === 'beyond-reach') return [];
        const estimatedSeconds = secondsFor(
          candidate.perimeterMetres,
          ability.typicalPaceSecondsPerKm
        );
        const base = {
          claimId: candidate.claimId,
          distanceMetres: candidate.perimeterMetres,
          areaSqm: candidate.areaSqm,
          targetSeconds: candidate.holderDurationSeconds,
          estimatedSeconds,
          successProbability: successProbability(
            estimatedSeconds,
            candidate.holderDurationSeconds,
            ability.runsConsidered
          ),
          difficulty,
          efficiency: loopEfficiency(candidate.areaSqm, candidate.perimeterMetres)
        };
        return [{ ...base, reason: reasonFor(base, ability) }];
      })
      // Chance first, then ground per metre run: between two loops somebody is
      // equally likely to take, the better suggestion is the one that returns
      // more territory for the same effort.
      .sort(
        (left, right) =>
          right.successProbability - left.successProbability ||
          right.efficiency - left.efficiency ||
          right.areaSqm - left.areaSqm
      )
      .slice(0, limit)
  );
};

/**
 * Shown above any recommendation. The estimate is from this runner's own recent
 * runs and nothing else, and it is an estimate.
 */
export const RECOMMENDATION_NOTE =
  'Estimated from your own recent runs — your usual distance and pace. It is a guess, not a promise, and it does not know the route, the traffic, or how you feel today.';

/** Shown instead of recommendations when there is not enough history. */
export const RECOMMENDATION_TOO_SOON =
  'Run a few more times and RunSphere can estimate which territories are within reach. Guessing from one or two runs would not tell you anything useful.';
