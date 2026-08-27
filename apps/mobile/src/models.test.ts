import { describe, expect, it } from 'vitest';
import { homeModel } from './models.js';

describe('home model', () => {
  it('keeps the approved starter experience deterministic', () => {
    expect(homeModel.dailyPath).toMatchObject({ found: 2, total: 3, rewardXp: 120 });
    expect(homeModel.nearbyQuest).toMatchObject({ id: 'riverside-rings', distanceKm: 1.2 });
  });
});
