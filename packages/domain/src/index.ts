import type { QuestDetail, QuestSummary } from '@runsphere/contracts';

export interface ValidatedActivityOutput {
  activeDurationSeconds: number;
  distanceMeters: number;
  acceptedPointCount: number;
  rejectedPointCount: number;
  rejectedGapCount: number;
}

/** Progress is derived only from the server validation output, never client-recorded totals. */
export const weeklyProgressFrom = (outputs: readonly ValidatedActivityOutput[]) => ({
  activeMinutes: Math.floor(
    outputs.reduce((total, output) => total + output.activeDurationSeconds, 0) / 60
  ),
  distanceMeters: Math.round(outputs.reduce((total, output) => total + output.distanceMeters, 0))
});

export const isPublishedQuest = (quest: Pick<QuestSummary, 'checkpointCount'>): boolean =>
  quest.checkpointCount > 0;

export type { QuestDetail, QuestSummary };
