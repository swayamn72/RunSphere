import { describe, expect, it } from 'vitest';
import { homeModel } from './models.js';

describe('home model', () => {
  it('keeps the approved starter experience deterministic without cosmetic XP', () => {
    expect(homeModel.dailyPath).toMatchObject({ found: 2, total: 3 });
    expect(homeModel.nearbyQuest).toMatchObject({ id: 'lantern-loop', distanceMeters: 2400 });
    expect(JSON.stringify(homeModel)).not.toContain('Xp');
  });
});
