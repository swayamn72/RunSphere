import type { QuestSummary } from '@runsphere/contracts';

/** Stable local examples keep the first-run experience useful before the quest API is reachable. */
export const homeModel = {
  dateLabel: 'FRIDAY · MUMBAI',
  member: { name: 'Maya', initials: 'MH' },
  dailyPath: { title: 'Creekside Collector', found: 2, total: 3 },
  nearbyQuest: {
    id: 'lantern-loop',
    title: 'Lantern Loop',
    distanceMeters: 2400,
    estimatedActiveMinutes: 45,
    accessibility: 'step-free',
    openHours: { timezone: 'Asia/Kolkata', schedule: 'Daily', status: 'open' },
    checkpointCount: 3
  } satisfies QuestSummary
} as const;
