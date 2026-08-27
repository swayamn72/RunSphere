import type { QuestSummary } from '@runsphere/contracts';

export const demoMember = {
  id: 'member-maya-h',
  name: 'Maya',
  initials: 'MH',
  city: 'Mumbai Metropolitan Region',
  weekDistanceKm: 12.8,
  seasonRank: 418
} as const;

export const demoQuests: readonly QuestSummary[] = [
  {
    id: 'riverside-rings',
    title: 'Riverside Rings',
    distanceKm: 1.2,
    durationMinutes: 25,
    rewardXp: 80,
    accessibility: 'step-free'
  },
  {
    id: 'lantern-loop',
    title: 'Lantern Loop',
    distanceKm: 1.8,
    durationMinutes: 30,
    rewardXp: 80,
    accessibility: 'step-free'
  },
  {
    id: 'creekside-collector',
    title: 'Creekside Collector',
    distanceKm: 2.4,
    durationMinutes: 40,
    rewardXp: 120,
    accessibility: 'mixed'
  }
] as const;

export const getQuestById = (id: string): QuestSummary | undefined =>
  demoQuests.find((quest) => quest.id === id);
