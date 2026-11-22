import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import {
  QUEST_PROGRESS_COPY,
  progressFor,
  questActionFailure,
  questRunStart
} from './quest-progress-model';

const mine = [
  {
    questId: 'a',
    title: 'A',
    status: 'accepted' as const,
    acceptedAt: '2026-11-21T00:00:00.000Z'
  },
  {
    questId: 'b',
    title: 'B',
    status: 'completed' as const,
    acceptedAt: '2026-11-20T00:00:00.000Z',
    completedAt: '2026-11-21T00:00:00.000Z'
  }
];

describe('quest progress (M6.3)', () => {
  it('reads the reader’s state for one quest', () => {
    expect(progressFor('a', mine)).toBe('taken');
    expect(progressFor('b', mine)).toBe('done');
    expect(progressFor('c', mine)).toBe('not-taken');
  });

  it('says what the next run needs to do, never asking for proof', () => {
    expect(QUEST_PROGRESS_COPY.taken.detail).toMatch(/Start your run from here/);
    expect(QUEST_PROGRESS_COPY.taken.detail).toMatch(/Other runs do not count/);
    for (const copy of Object.values(QUEST_PROGRESS_COPY))
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/photo|upload|check in|tap to complete/i);
  });

  it('starts a quest run only for a quest you are on (M9 9.5)', () => {
    expect(questRunStart('a', 'taken')).toEqual({ mode: 'quest', questId: 'a' });
    expect(questRunStart('a', 'not-taken')).toBeUndefined();
    expect(questRunStart('a', 'done')).toBeUndefined();
    expect(questRunStart('a', undefined)).toBeUndefined();
  });

  it('explains a quest that is gone', () => {
    expect(questActionFailure(new ApiFailure(404, 'Quest not found'))).toMatch(/isn't available/);
  });
});
