import { describe, expect, it } from 'vitest';
import {
  QUEST_COLD_START_INTERACTIONS,
  QUEST_EMPTY_NOTE,
  QUEST_FLEET_INTERACTION_FLOOR,
  QUEST_MODEL_NOTE,
  QUEST_PROXIMITY_NOTE,
  QUEST_RECOMMENDATION_LIMIT,
  QUEST_RECOMMENDATION_RADIUS_METRES,
  questModelIsWorthFitting,
  recommendQuests,
  type QuestCandidate
} from './quest-recommendation.js';

const candidate = (overrides: Partial<QuestCandidate> & { questId: string }): QuestCandidate => ({
  distanceMetres: 1_000,
  seen: false,
  ...overrides
});

describe('cold start, which is the state this ships in', () => {
  it('sorts by distance when the runner has no history', () => {
    // Nothing writes a quest interaction yet, so this is the real path — not a
    // fallback nobody exercises.
    const result = recommendQuests(
      [
        candidate({ questId: 'far', distanceMetres: 8_000 }),
        candidate({ questId: 'near', distanceMetres: 400 }),
        candidate({ questId: 'mid', distanceMetres: 2_000 })
      ],
      0
    );

    expect(result.basis).toBe('proximity');
    expect(result.data.map((entry) => entry.questId)).toEqual(['near', 'mid', 'far']);
  });

  it('says the list is by distance rather than dressing it up as personal', () => {
    const result = recommendQuests([candidate({ questId: 'a' })], 0);

    expect(result.note).toBe(QUEST_PROXIMITY_NOTE);
    expect(result.note).toContain('close they are');
  });

  it('ignores a score when the runner has too little history to trust one', () => {
    // Matrix factorisation on one interaction produces a confident-looking
    // vector from a single data point.
    const result = recommendQuests(
      [
        candidate({ questId: 'scored-far', distanceMetres: 9_000, score: 0.99 }),
        candidate({ questId: 'near', distanceMetres: 100 })
      ],
      QUEST_COLD_START_INTERACTIONS - 1
    );

    expect(result.basis).toBe('proximity');
    expect(result.data[0]?.questId).toBe('near');
  });

  it('switches to the model at the interaction floor', () => {
    const result = recommendQuests(
      [
        candidate({ questId: 'scored-far', distanceMetres: 9_000, score: 0.99 }),
        candidate({ questId: 'near', distanceMetres: 100, score: 0.1 })
      ],
      QUEST_COLD_START_INTERACTIONS
    );

    expect(result.basis).toBe('model');
    expect(result.data[0]?.questId).toBe('scored-far');
    expect(result.note).toBe(QUEST_MODEL_NOTE);
  });

  it('falls back to proximity when the model has no opinion on anything nearby', () => {
    const result = recommendQuests([candidate({ questId: 'near' })], 50);

    expect(result.basis).toBe('proximity');
  });
});

describe('what is never recommended', () => {
  it('never offers a quest already accepted or completed', () => {
    // `filter_already_liked=True` in the training script says the same; saying
    // it twice is the difference between a recommendation and a reminder.
    const result = recommendQuests(
      [
        candidate({ questId: 'done', distanceMetres: 10, score: 0.99, seen: true }),
        candidate({ questId: 'new', distanceMetres: 5_000, score: 0.2 })
      ],
      50
    );

    expect(result.data.map((entry) => entry.questId)).toEqual(['new']);
  });

  it('never offers a quest beyond the published radius', () => {
    // `ml.md`: "only quests within 20 km".
    const result = recommendQuests(
      [
        candidate({ questId: 'too-far', distanceMetres: QUEST_RECOMMENDATION_RADIUS_METRES + 1 }),
        candidate({ questId: 'edge', distanceMetres: QUEST_RECOMMENDATION_RADIUS_METRES })
      ],
      0
    );

    expect(result.data.map((entry) => entry.questId)).toEqual(['edge']);
  });

  it('says so plainly when there is nothing to offer', () => {
    const result = recommendQuests([candidate({ questId: 'far', distanceMetres: 90_000 })], 50);

    expect(result.data).toEqual([]);
    // The empty-state copy `screens.md` already specifies for the quest list.
    expect(result.note).toBe(QUEST_EMPTY_NOTE);
  });
});

describe('the shape of the answer', () => {
  it('returns at most five', () => {
    const many = Array.from({ length: 12 }, (_unused, index) =>
      candidate({ questId: `q${index}`, distanceMetres: index * 100 })
    );

    expect(recommendQuests(many, 0).data).toHaveLength(QUEST_RECOMMENDATION_LIMIT);
    expect(QUEST_RECOMMENDATION_LIMIT).toBe(5);
  });

  it('breaks ties the same way every time, so a poll does not reshuffle', () => {
    const tied = [
      candidate({ questId: 'b', distanceMetres: 500, score: 0.5 }),
      candidate({ questId: 'a', distanceMetres: 500, score: 0.5 }),
      candidate({ questId: 'c', distanceMetres: 100, score: 0.5 })
    ];

    // Same score: nearer first, then by id.
    expect(recommendQuests(tied, 50).data.map((entry) => entry.questId)).toEqual(['c', 'a', 'b']);
    expect(recommendQuests([...tied].reverse(), 50).data.map((entry) => entry.questId)).toEqual([
      'c',
      'a',
      'b'
    ]);
  });

  it('says which basis each entry came from', () => {
    const result = recommendQuests([candidate({ questId: 'a', score: 0.5 })], 50);

    expect(result.data[0]?.basis).toBe('model');
    expect(result.data[0]?.distanceMetres).toBe(1_000);
  });
});

describe('whether the model is worth fitting at all', () => {
  it('refuses to fit a handful of interactions', () => {
    // A tiny matrix factorises happily and produces numbers that look like
    // recommendations.
    expect(questModelIsWorthFitting(QUEST_FLEET_INTERACTION_FLOOR - 1)).toBe(false);
    expect(questModelIsWorthFitting(0)).toBe(false);
  });

  it('fits once the fleet has enough', () => {
    expect(questModelIsWorthFitting(QUEST_FLEET_INTERACTION_FLOOR)).toBe(true);
  });
});
