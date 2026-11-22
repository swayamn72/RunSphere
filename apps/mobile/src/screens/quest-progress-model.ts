import type { MyQuest } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';
import type { RunStart } from '../run-start';

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
    detail: 'Start your run from here and pass every stop on it. Other runs do not count.'
  },
  done: {
    title: 'Quest complete',
    detail: 'You passed every stop. Nice loop.'
  }
};

/**
 * The run this quest's Start button begins, or nothing when there's no quest
 * run to start. Only a quest you've taken on and not finished can have one:
 * the server refuses a quest run for anything else (M9 9.3), and only a quest
 * run can complete a quest (9.4).
 */
export const questRunStart = (
  questId: string,
  progress: QuestProgress | undefined
): RunStart | undefined => (progress === 'taken' ? { mode: 'quest', questId } : undefined);

/** Shown in place of Start when there's no quest run to start. */
export const QUEST_START_HINT: Readonly<Record<Exclude<QuestProgress, 'taken'>, string>> = {
  'not-taken': 'Take it on first, then start your run.',
  done: "You've finished this one."
};

export const questActionFailure = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 404
    ? "This quest isn't available any more."
    : failureMessage(error, "Couldn't update this quest. Try again.");
