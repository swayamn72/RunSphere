import { demoMember, demoQuests } from '@runsphere/domain';

export const homeModel = {
  dateLabel: 'THURSDAY · AUG 27',
  member: demoMember,
  dailyPath: { title: 'Creekside Collector', found: 2, total: 3, rewardXp: 120 },
  nearbyQuest: demoQuests[0]!
} as const;
