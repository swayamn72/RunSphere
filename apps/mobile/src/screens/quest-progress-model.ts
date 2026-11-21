import type { MyQuest } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';

/**
 * Taking a quest on and finishing it (M6.3). The server decides completion
 * from your runs, so the app only ever says what state you're in and what
 * the next run needs to do.
 */
export type QuestProgress = 'not-taken' | 'taken' | 'done';

export const progressFor = (questId: string, mine: readonly MyQuest[]): QuestProgress => {
  const entry = mine.find((quest) => quest.questId === questId);
  if (!entry) return 'not-taken';
  return entry.status === 'completed' ? 'done' : 'taken';
};

export const QUEST_PROGRESS_COPY: Readonly<
  Record<QuestProgress, { title: string; detail: string }>
> = {
  'not-taken': {
    title: 'Take this quest',
    detail: 'Pass every stop on one run and it completes on its own.'
  },
  taken: {
    title: "You're on this quest",
    detail: 'Pass every stop on one run. Runs you started before taking it on do not count.'
  },
  done: {
    title: 'Quest complete',
    detail: 'You passed every stop. Nice loop.'
  }
};

export const questActionFailure = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 404
    ? "This quest isn't available any more."
    : failureMessage(error, "Couldn't update this quest. Try again.");
