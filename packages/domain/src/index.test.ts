import { describe, expect, it } from 'vitest';
import { demoQuests, getQuestById } from './index.js';

describe('demo quest domain', () => {
  it('uses deterministic MMR starter data', () => {
    expect(demoQuests).toHaveLength(3);
    expect(getQuestById('lantern-loop')).toMatchObject({
      rewardXp: 80,
      accessibility: 'step-free'
    });
  });
});
