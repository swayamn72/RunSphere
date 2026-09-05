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
export * from './gamification.js';
export * from './progression.js';
export * from './achievement.js';
export * from './challenge.js';
export * from './notification-delivery.js';
export * from './club.js';
export * from './global-board.js';
export * from './competition.js';
export * from './moderation.js';
export * from './campaign.js';
export * from './territory.js';
export * from './territory-scoring.js';
export * from './territory-season.js';
