import type { AccountExportResponse } from '@runsphere/contracts';
import { describe, expect, it } from 'vitest';
import { exportShareText } from './data-export-model';

const result: AccountExportResponse = {
  status: 'ready',
  generatedAt: '2026-11-26T10:00:00.000Z',
  data: {
    account: {
      email: 'maya@example.com',
      emailVerified: true,
      username: 'maya',
      displayName: 'Maya',
      homeArea: null,
      avatar: { avatarKey: 'default' },
      ageCheckedAt: '2026-11-01T10:00:00.000Z',
      createdAt: '2026-11-01T10:00:00.000Z'
    },
    privacySettings: null,
    privacyZones: [],
    runs: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        recordedAt: '2026-11-20T01:00:00.000Z',
        status: 'derived',
        runMode: 'free',
        distanceMeters: 5012.4,
        durationSeconds: 1800,
        rawGpsKeptUntil: null
      }
    ],
    turfClaims: [],
    xp: [],
    achievements: [],
    friends: [],
    blocked: [],
    safetyContacts: [],
    reportsMade: [],
    notificationChoices: null,
    devices: [],
    agreements: []
  }
};

describe('data export share text', () => {
  it('is the whole export as readable JSON, labelled with the app', () => {
    const text = exportShareText(result);
    expect(JSON.parse(text)).toEqual({ ...result, app: 'TURFR' });
    expect(text).toContain('\n  "data": {');
  });
});
