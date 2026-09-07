import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_SCORE_UNIT,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_KIND_BY_TYPE,
  NOTIFICATION_NAME_FALLBACK,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATION_TYPES_WITHOUT_PRODUCERS,
  carveDefended,
  carveSuccess,
  challengeDrawn,
  challengeLost,
  challengeReceived,
  challengeWon,
  formatAreaSqm,
  ghostIncoming,
  questAvailable,
  questComplete,
  safeName,
  seasonEnded,
  seasonEnding,
  streakReached,
  weeklyRank,
  type NotificationCopy,
  type NotificationType
} from './notification-catalogue.js';
import {
  NOTIFICATION_CATEGORY_BY_KIND,
  defaultNotificationPreferences
} from './notification-delivery.js';

const CLAIM = '11111111-1111-4111-8111-111111111111';

/** One rendered example of every type, so a test can walk the catalogue. */
const everyType: Readonly<Record<NotificationType, NotificationCopy>> = {
  CARVE_SUCCESS: carveSuccess({
    claimId: CLAIM,
    runnerName: 'Mira',
    areaName: 'Bandra',
    takenSqm: 8_400,
    heldSqm: 23_000
  }),
  CARVE_DEFENDED: carveDefended({ claimId: CLAIM, runnerName: 'Mira', areaName: 'Bandra' }),
  GHOST_INCOMING: ghostIncoming({ claimId: CLAIM, runnerName: 'Mira' }),
  WEEKLY_RANK: weeklyRank({
    weekStart: '2026-09-07',
    rank: 4,
    totalAreaSqm: 31_400,
    cityTag: 'Mumbai'
  }),
  SEASON_ENDING_3D: seasonEnding({
    seasonMonth: '2026-09',
    rank: 4,
    totalAreaSqm: 31_400,
    daysRemaining: 3
  }),
  SEASON_ENDED: seasonEnded({
    seasonMonth: '2026-09',
    rank: 4,
    peakAreaSqm: 42_000,
    cityTag: 'Mumbai'
  }),
  QUEST_AVAILABLE: questAvailable({ questId: CLAIM, questName: 'Shivaji Park Loop', xp: 120 }),
  QUEST_COMPLETE: questComplete({ questName: 'Shivaji Park Loop', xp: 120 }),
  CHALLENGE_RECEIVED: challengeReceived({
    challengeId: CLAIM,
    runnerName: 'Coda',
    days: 7,
    modeLabel: 'Active minutes'
  }),
  CHALLENGE_WON: challengeWon({
    challengeId: CLAIM,
    runnerName: 'Coda',
    yourScore: 210,
    theirScore: 180,
    unit: 'min'
  }),
  CHALLENGE_LOST: challengeLost({
    challengeId: CLAIM,
    runnerName: 'Coda',
    yourScore: 180,
    theirScore: 210,
    unit: 'min'
  }),
  STREAK: streakReached({ runs: 12 })
};

const types = Object.keys(everyType) as NotificationType[];

describe('the catalogue covers all twelve types', () => {
  it('has exactly the twelve types screens.md names', () => {
    expect(types).toHaveLength(12);
    expect(new Set(types).size).toBe(12);
  });

  it('renders each one with a title, a body, and somewhere to go', () => {
    for (const type of types) {
      const rendered = everyType[type];
      expect(rendered.type).toBe(type);
      expect(rendered.title).toMatch(/\S/);
      expect(rendered.body).toMatch(/\S/);
      expect(rendered.deepLink.startsWith('runsphere://')).toBe(true);
    }
  });

  it('declares the same kind it renders', () => {
    for (const type of types) {
      expect(everyType[type].kind).toBe(NOTIFICATION_KIND_BY_TYPE[type]);
    }
  });

  it('gives every type a preference toggle that governs it', () => {
    // The point of screens.md's "per-type on/off": no type may be unswitchable.
    const categories = defaultNotificationPreferences().categories;
    for (const type of types) {
      const category = NOTIFICATION_CATEGORY_BY_KIND[everyType[type].kind];
      expect(category).toBeDefined();
      expect(Object.keys(categories)).toContain(category);
    }
  });

  it('stays inside the column limits', () => {
    for (const type of types) {
      expect(everyType[type].title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
      expect(everyType[type].body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    }
  });
});

describe('what a body may never contain', () => {
  it('carries no coordinate, however the numbers are formatted', () => {
    // screens.md: "No raw location, route, or activity detail in any message
    // body". Nothing here takes a coordinate, so this asserts the outcome of
    // that rather than a filter.
    for (const type of types) {
      const body = everyType[type].body;
      // A decimal degree pair, in either order, with any separator.
      expect(body).not.toMatch(/-?\d{1,3}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/);
      // Latitude/longitude by name.
      expect(body.toLowerCase()).not.toMatch(/latitude|longitude|\blat\b|\blng\b/);
    }
  });

  it('carries no email address and no phone number', () => {
    for (const type of types) {
      expect(everyType[type].body).not.toMatch(/@/);
      expect(everyType[type].body).not.toMatch(/\d[\d\s()+.-]{5,}\d/);
    }
  });

  it('replaces an email address passed as a name', () => {
    // Nothing should be able to do this — display names are validated 1-40
    // characters — but a body is what lands on a lock screen, so it refuses.
    const rendered = carveDefended({ claimId: CLAIM, runnerName: 'mira@example.com' });

    expect(rendered.body).toContain(NOTIFICATION_NAME_FALLBACK);
    expect(rendered.body).not.toContain('mira@example.com');
  });

  it('replaces a phone number passed as a name', () => {
    expect(safeName('+91 98765 43210')).toBe(NOTIFICATION_NAME_FALLBACK);
    expect(safeName('9876543210')).toBe(NOTIFICATION_NAME_FALLBACK);
  });

  it('names an anonymous runner rather than leaving a gap', () => {
    expect(safeName(undefined)).toBe(NOTIFICATION_NAME_FALLBACK);
    expect(safeName('   ')).toBe(NOTIFICATION_NAME_FALLBACK);
  });

  it('keeps an ordinary name, including one with digits in it', () => {
    expect(safeName('Mira')).toBe('Mira');
    // Two digits is a name somebody chose, not a phone number.
    expect(safeName('runner42')).toBe('runner42');
  });

  it('truncates a name too long for the column', () => {
    expect(safeName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('the copy screens.md specifies', () => {
  it('says who took how much, and what is left', () => {
    expect(everyType.CARVE_SUCCESS.body).toBe(
      'Mira ran through your ground in Bandra. They took 8,400 m². You still hold 23,000 m².'
    );
  });

  it('says the whole claim went, rather than that 0 m² is still held', () => {
    // A wipe-out is the same event, and screens.md's copy assumes a partial.
    const rendered = carveSuccess({
      claimId: CLAIM,
      runnerName: 'Mira',
      areaName: 'Bandra',
      takenSqm: 31_400,
      heldSqm: 0
    });

    expect(rendered.body).toBe(
      'Mira ran through your ground in Bandra. They took 31,400 m² — all of it.'
    );
    expect(rendered.body).not.toContain('still hold');
  });

  it('drops the place when the claim has no geocode, rather than saying undefined', () => {
    // `038` makes the tags nullable on purpose: a geocoder outage must not
    // refuse a claim, so it must not garble a notice either.
    const rendered = carveSuccess({
      claimId: CLAIM,
      runnerName: 'Mira',
      takenSqm: 8_400,
      heldSqm: 23_000
    });

    expect(rendered.body).toBe(
      'Mira ran through your ground. They took 8,400 m². You still hold 23,000 m².'
    );
    expect(rendered.body).not.toMatch(/undefined|null/);
  });

  it('tells a defender their claim stands', () => {
    expect(everyType.CARVE_DEFENDED.body).toBe(
      "Mira tried to take your ground in Bandra. They weren't fast enough. Your claim stands."
    );
  });

  it('matches the season and week wording already in use', () => {
    expect(everyType.WEEKLY_RANK.body).toBe('Week summary: Rank #4 in Mumbai · 31,400 m² held.');
    expect(everyType.SEASON_ENDED.body).toBe(
      'Season ended. Final rank: #4 in Mumbai. Peak: 42,000 m². New season starts now.'
    );
    expect(everyType.SEASON_ENDING_3D.body).toBe(
      'Season ends in 3 days. You hold rank #4 with 31,400 m². Keep running.'
    );
    // Says what is true, not what screens.md hardcoded: the job is
    // state-driven, so it can fire with less time left than three days.
    expect(
      seasonEnding({ seasonMonth: '2026-09', rank: 4, totalAreaSqm: 31_400, daysRemaining: 1 }).body
    ).toContain('Season ends tomorrow');
    expect(
      seasonEnding({ seasonMonth: '2026-09', rank: 4, totalAreaSqm: 31_400, daysRemaining: 2 }).body
    ).toContain('in 2 days');
  });

  it('names the mode a challenge is scored on rather than assuming minutes', () => {
    // screens.md hardcodes "Active minutes", but `ChallengeModeSchema` has
    // three modes and a notice that names the wrong one is a lie about the
    // rules somebody is about to accept.
    expect(everyType.CHALLENGE_RECEIVED.body).toBe(
      'Coda challenged you. 7-day battle. Active minutes. Accept?'
    );
    expect(
      challengeReceived({
        challengeId: CLAIM,
        runnerName: 'Coda',
        days: 7,
        modeLabel: 'Active days'
      }).body
    ).toContain('Active days');
  });

  it('reports both results without gloating or blaming', () => {
    expect(everyType.CHALLENGE_WON.body).toBe('You beat Coda. 210 min vs 180 min.');
    expect(everyType.CHALLENGE_LOST.body).toBe('Coda edged you. 180 min vs 210 min. Rematch?');
  });

  it('counts a challenge in the unit it was scored in', () => {
    // screens.md hardcodes minutes; two of the three modes are not minutes.
    expect(
      challengeWon({
        challengeId: CLAIM,
        runnerName: 'Coda',
        yourScore: 5,
        theirScore: 4,
        unit: CHALLENGE_SCORE_UNIT.active_days!
      }).body
    ).toBe('You beat Coda. 5 days vs 4 days.');
  });

  it('has words for a draw, which screens.md does not cover', () => {
    const drawn = challengeDrawn({
      challengeId: CLAIM,
      runnerName: 'Coda',
      yourScore: 180,
      theirScore: 180,
      unit: 'min'
    });

    expect(drawn.body).toBe('You and Coda finished level. 180 min vs 180 min. Rematch?');
    expect(drawn.kind).toBe('challenge_finished');
  });

  it('keeps the quest and streak copy', () => {
    expect(everyType.QUEST_AVAILABLE.body).toBe('New quest near you: Shivaji Park Loop · 120 XP');
    expect(everyType.QUEST_COMPLETE.body).toBe('Shivaji Park Loop — done. +120 XP.');
    expect(everyType.STREAK.body).toBe('12 runs in a row. Rho is watching.');
  });
});

describe('where a tap goes', () => {
  it('points the three claim notices at the claim itself', () => {
    for (const type of ['CARVE_SUCCESS', 'CARVE_DEFENDED', 'GHOST_INCOMING'] as const) {
      expect(everyType[type].deepLink).toBe(`runsphere://turf/claim/${CLAIM}`);
    }
  });

  it('points the season notices at Turf', () => {
    expect(everyType.WEEKLY_RANK.deepLink).toBe('runsphere://turf/leaderboard/week/2026-09-07');
    expect(everyType.SEASON_ENDED.deepLink).toBe('runsphere://turf/season/2026-09');
    expect(everyType.SEASON_ENDING_3D.deepLink).toBe('runsphere://turf/season/2026-09');
  });

  it('keeps the challenge link shape the mobile router already recognises', () => {
    // `notifications-model.ts` routes on `runsphere://challenges/`.
    for (const type of ['CHALLENGE_RECEIVED', 'CHALLENGE_WON', 'CHALLENGE_LOST'] as const) {
      expect(everyType[type].deepLink.startsWith('runsphere://challenges/')).toBe(true);
    }
  });
});

describe('honesty about what is not built', () => {
  it('records a reason for every type with no producer', () => {
    const unbuilt = Object.keys(NOTIFICATION_TYPES_WITHOUT_PRODUCERS) as NotificationType[];

    expect(unbuilt.sort()).toEqual([
      'GHOST_INCOMING',
      'QUEST_AVAILABLE',
      'QUEST_COMPLETE',
      'STREAK'
    ]);
    for (const type of unbuilt) {
      expect(NOTIFICATION_TYPES_WITHOUT_PRODUCERS[type]).toMatch(/\S/);
    }
  });

  it('lists only real types', () => {
    for (const type of Object.keys(NOTIFICATION_TYPES_WITHOUT_PRODUCERS)) {
      expect(types).toContain(type as NotificationType);
    }
  });
});

describe('area formatting', () => {
  it('groups the way the rest of the app does', () => {
    expect(formatAreaSqm(31_400)).toBe('31,400 m²');
    expect(formatAreaSqm(1_963.27)).toBe('1,963 m²');
  });

  it('never reports negative ground', () => {
    expect(formatAreaSqm(-5)).toBe('0 m²');
  });
});
