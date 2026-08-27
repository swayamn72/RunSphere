import { productConfig } from '@runsphere/config';
import { demoMember, demoQuests } from '@runsphere/domain';

export const adminShellModel = {
  heading: 'Good morning, Mumbai.',
  market: productConfig.market,
  monthlyInfraBudgetInr: productConfig.monthlyInfraBudgetInr,
  quests: demoQuests,
  demoMemberName: demoMember.name
} as const;
