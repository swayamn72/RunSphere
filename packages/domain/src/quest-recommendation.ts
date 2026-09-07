/**
 * Quest recommendations (`ml.md` System 2).
 *
 * Collaborative filtering over which quests people accepted and completed —
 * never over where they were. `ml.md`: "The recommendation model only sees
 * which quests were interacted with, not where the user was."
 *
 * **Nothing writes an interaction yet.** `ml.md` states that
 * `quest_acceptances` and `quest_completions` "already exist in
 * `008_product_core_goals_quests.sql`". They did not: `008` creates
 * `quest_versions` and `quest_version_checkpoints`, and no quest is ever
 * assigned to an account or recorded as finished anywhere in the system. The
 * tables are created by `045`, and the serving path below is built to be
 * correct on an empty one — which is not a hypothetical, it is the state it
 * will be in until the quest lifecycle is built.
 *
 * So the cold-start path is the *real* path for now, and it gets the care that
 * implies rather than being a fallback nobody looked at.
 */

/** `ml.md`: "Returns up to 5 quest IDs sorted by the recommendation score". */
export const QUEST_RECOMMENDATION_LIMIT = 5;

/** `ml.md`: "only quests within 20 km of the user's current location". */
export const QUEST_RECOMMENDATION_RADIUS_METRES = 20_000;

/**
 * How many interactions somebody needs before the model has anything to say
 * about them.
 *
 * Matrix factorisation on one interaction produces a confident-looking vector
 * from a single data point. Below this the answer is proximity, and it is
 * labelled as such rather than dressed up as a recommendation.
 */
export const QUEST_COLD_START_INTERACTIONS = 3;

export interface QuestCandidate {
  readonly questId: string;
  /** Metres from the runner's coarse position. */
  readonly distanceMetres: number;
  /** Model score, absent when the model has never seen this pair. */
  readonly score?: number;
  /** Already accepted or completed: never recommended again. */
  readonly seen: boolean;
}

export type QuestRecommendationBasis = 'model' | 'proximity';

export interface QuestRecommendation {
  readonly questId: string;
  readonly basis: QuestRecommendationBasis;
  readonly distanceMetres: number;
}

export interface QuestRecommendationResult {
  readonly data: readonly QuestRecommendation[];
  readonly basis: QuestRecommendationBasis;
  /** Words for the app, so a proximity list is never presented as personal. */
  readonly note: string;
}

export const QUEST_MODEL_NOTE =
  'Suggested from quests people with similar taste finished. Distance is the only thing about you that was used to filter them.';

export const QUEST_PROXIMITY_NOTE =
  'Sorted by how close they are. Once you have finished a few quests, this list starts reflecting what you actually enjoy.';

export const QUEST_EMPTY_NOTE = 'No quests near you right now. Try a free run and explore.';

/**
 * The list, from candidates and how much history the runner has.
 *
 * Two rules that are easy to get wrong and are therefore here rather than in
 * the route:
 *
 *   * **A quest already seen is never recommended**, even with a high score.
 *     `filter_already_liked=True` in the training script says the same thing;
 *     saying it twice is deliberate, because the filter is the difference
 *     between a recommendation and a reminder.
 *   * **Ties break on distance, then on id.** Two quests with the same score
 *     must come back in the same order on every request, or the list reshuffles
 *     under the reader's thumb between polls.
 */
export const recommendQuests = (
  candidates: readonly QuestCandidate[],
  interactionCount: number,
  limit: number = QUEST_RECOMMENDATION_LIMIT
): QuestRecommendationResult => {
  const eligible = candidates.filter(
    (candidate) => !candidate.seen && candidate.distanceMetres <= QUEST_RECOMMENDATION_RADIUS_METRES
  );
  if (eligible.length === 0) return { data: [], basis: 'proximity', note: QUEST_EMPTY_NOTE };

  const scored = eligible.filter((candidate) => typeof candidate.score === 'number');
  const useModel = interactionCount >= QUEST_COLD_START_INTERACTIONS && scored.length > 0;

  if (!useModel) {
    return {
      data: [...eligible]
        .sort(byDistanceThenId)
        .slice(0, limit)
        .map((candidate) => ({
          questId: candidate.questId,
          basis: 'proximity' as const,
          distanceMetres: candidate.distanceMetres
        })),
      basis: 'proximity',
      note: QUEST_PROXIMITY_NOTE
    };
  }

  return {
    data: [...scored]
      .sort((left, right) =>
        (right.score ?? 0) === (left.score ?? 0)
          ? byDistanceThenId(left, right)
          : (right.score ?? 0) - (left.score ?? 0)
      )
      .slice(0, limit)
      .map((candidate) => ({
        questId: candidate.questId,
        basis: 'model' as const,
        distanceMetres: candidate.distanceMetres
      })),
    basis: 'model',
    note: QUEST_MODEL_NOTE
  };
};

const byDistanceThenId = (left: QuestCandidate, right: QuestCandidate): number =>
  left.distanceMetres === right.distanceMetres
    ? left.questId.localeCompare(right.questId)
    : left.distanceMetres - right.distanceMetres;

/** `ml.md`: "Retrain cadence: Weekly." */
export const QUEST_RETRAIN_INTERVAL_DAYS = 7;

/**
 * Whether the recommender has enough interactions across the whole fleet to be
 * worth fitting at all.
 *
 * A matrix with a handful of interactions factorises happily and produces
 * numbers that look like recommendations. The floor is what stops the endpoint
 * switching from an honest proximity list to a confident wrong one on the day
 * the tenth quest is completed.
 */
export const QUEST_FLEET_INTERACTION_FLOOR = 500;

export const questModelIsWorthFitting = (fleetInteractions: number): boolean =>
  fleetInteractions >= QUEST_FLEET_INTERACTION_FLOOR;
