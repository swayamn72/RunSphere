import { describe, expect, it } from 'vitest';
import {
  CLUB_ROLES,
  canManageClubChallenge,
  canManageRelay,
  clubChallengeLengthEnabled,
  clubChallengeModeEnabled,
  clubChallengeOpen,
  parseClubRelayRule,
  relayGoalMet,
  relayMemberUnits,
  relayProgressPercent,
  relayTargetAllowed,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  canArchive,
  canChangeRole,
  canInvite,
  canLeave,
  canRemoveMember,
  isPlausibleInviteCode,
  normalizeInviteCode,
  outranks,
  visibleToMember
} from './club.js';
import { parseChallengeRule } from './challenge.js';

describe('the role ladder', () => {
  it('ranks owner over admin over member', () => {
    expect(outranks('owner', 'admin')).toBe(true);
    expect(outranks('admin', 'member')).toBe(true);
    expect(outranks('owner', 'member')).toBe(true);
  });

  it('gives an equal role no authority over an equal', () => {
    for (const role of CLUB_ROLES) expect(outranks(role, role)).toBe(false);
  });

  it('never lets a lower role act on a higher one', () => {
    expect(outranks('member', 'admin')).toBe(false);
    expect(outranks('admin', 'owner')).toBe(false);
  });
});

describe('removing a member', () => {
  it('lets an owner remove an admin or a member', () => {
    expect(canRemoveMember('owner', 'admin', { self: false })).toBe(true);
    expect(canRemoveMember('owner', 'member', { self: false })).toBe(true);
  });

  it('lets an admin remove a member but not a fellow admin', () => {
    expect(canRemoveMember('admin', 'member', { self: false })).toBe(true);
    expect(canRemoveMember('admin', 'admin', { self: false })).toBe(false);
  });

  it('never removes the owner', () => {
    expect(canRemoveMember('admin', 'owner', { self: false })).toBe(false);
    expect(canRemoveMember('owner', 'owner', { self: false })).toBe(false);
  });

  it('is not the route for removing yourself, which is leaving', () => {
    expect(canRemoveMember('owner', 'owner', { self: true })).toBe(false);
    expect(canRemoveMember('member', 'member', { self: true })).toBe(false);
  });

  it('gives a plain member no removal authority at all', () => {
    for (const target of CLUB_ROLES)
      expect(canRemoveMember('member', target, { self: false })).toBe(false);
  });
});

describe('changing a role', () => {
  it('is the owner alone', () => {
    expect(canChangeRole('owner', 'member', { self: false })).toBe(true);
    expect(canChangeRole('admin', 'member', { self: false })).toBe(false);
    expect(canChangeRole('member', 'member', { self: false })).toBe(false);
  });

  it('never touches the owner row, including the owner own', () => {
    expect(canChangeRole('owner', 'owner', { self: false })).toBe(false);
    expect(canChangeRole('owner', 'owner', { self: true })).toBe(false);
  });
});

describe('leaving', () => {
  it('lets an admin or member leave whenever they like', () => {
    expect(canLeave('admin', 5)).toBe(true);
    expect(canLeave('member', 5)).toBe(true);
  });

  it('holds the owner until they are the last member', () => {
    expect(canLeave('owner', 2)).toBe(false);
    expect(canLeave('owner', 1)).toBe(true);
  });
});

describe('club-wide authority', () => {
  it('keeps archiving with the owner', () => {
    expect(canArchive('owner')).toBe(true);
    expect(canArchive('admin')).toBe(false);
    expect(canArchive('member')).toBe(false);
  });

  it('lets an owner or admin hand out the invite code', () => {
    expect(canInvite('owner')).toBe(true);
    expect(canInvite('admin')).toBe(true);
    expect(canInvite('member')).toBe(false);
  });
});

describe('invite codes', () => {
  it('excludes characters that are read wrongly off a screen', () => {
    for (const ambiguous of ['O', '0', 'I', '1', 'L'])
      expect(INVITE_CODE_ALPHABET).not.toContain(ambiguous);
    expect(INVITE_CODE_LENGTH).toBeGreaterThanOrEqual(6);
  });

  it('compares case-insensitively and ignores separators a person typed', () => {
    expect(normalizeInviteCode(' ab7-k9 ')).toBe('AB7K9');
    expect(normalizeInviteCode('AB7K9')).toBe('AB7K9');
  });

  it('rejects a code that cannot be one before it reaches the database', () => {
    expect(isPlausibleInviteCode('ABC23')).toBe(false);
    expect(isPlausibleInviteCode('ABCDEF')).toBe(true);
    expect(isPlausibleInviteCode('ABCDE0')).toBe(false);
    expect(isPlausibleInviteCode('A'.repeat(33))).toBe(false);
  });
});

describe('member visibility', () => {
  it('hides a blocked account from a club roster, in either direction', () => {
    expect(visibleToMember({ blockedEitherWay: true, self: false })).toBe(false);
    expect(visibleToMember({ blockedEitherWay: false, self: false })).toBe(true);
  });

  it('never hides the reader from their own roster', () => {
    expect(visibleToMember({ blockedEitherWay: true, self: true })).toBe(true);
  });
});

const relayRule = {
  dailyCapMinutes: 240,
  memberWeeklyCapMinutes: 600,
  minTargetUnits: 60,
  maxTargetUnits: 20_000
};

const minutes = (isoDay: string, count: number) => ({
  activeDurationSeconds: count * 60,
  endedAt: `${isoDay}T10:00:00.000Z`
});

describe('the published relay rule', () => {
  it('accepts a well-formed definition', () => {
    expect(parseClubRelayRule({ ...relayRule })).toEqual(relayRule);
  });

  it('fails loudly rather than scoring a relay from a malformed rule', () => {
    expect(() => parseClubRelayRule(null)).toThrow('must be a JSON object');
    expect(() => parseClubRelayRule({ ...relayRule, dailyCapMinutes: 0 })).toThrow(
      'dailyCapMinutes'
    );
    expect(() => parseClubRelayRule({ ...relayRule, memberWeeklyCapMinutes: 1.5 })).toThrow(
      'memberWeeklyCapMinutes'
    );
    expect(() => parseClubRelayRule({ ...relayRule, maxTargetUnits: 10 })).toThrow('at least');
  });
});

describe('relay authority', () => {
  it('lets an owner or admin manage the relay, and no one else', () => {
    expect(canManageRelay('owner')).toBe(true);
    expect(canManageRelay('admin')).toBe(true);
    expect(canManageRelay('member')).toBe(false);
  });
});

describe('relay target', () => {
  it('holds the target inside the published bounds', () => {
    expect(relayTargetAllowed(relayRule, 60)).toBe(true);
    expect(relayTargetAllowed(relayRule, 20_000)).toBe(true);
    expect(relayTargetAllowed(relayRule, 59)).toBe(false);
    expect(relayTargetAllowed(relayRule, 20_001)).toBe(false);
    expect(relayTargetAllowed(relayRule, 60.5)).toBe(false);
  });
});

describe('relay member units', () => {
  // 2026-08-31 is a Monday in Asia/Kolkata terms for these instants.
  const weekStart = new Date('2026-08-30T18:30:00.000Z');

  it('sums capped validated minutes across the week', () => {
    expect(
      relayMemberUnits([minutes('2026-08-31', 30), minutes('2026-09-01', 45)], weekStart, relayRule)
    ).toBe(75);
  });

  it('applies the per-day cap before the weekly one', () => {
    const heavy = [minutes('2026-08-31', 400), minutes('2026-09-01', 400)];
    // 240 + 240 = 480, under the 600 weekly ceiling.
    expect(relayMemberUnits(heavy, weekStart, relayRule)).toBe(480);
  });

  it('stops one very active member from carrying the whole target', () => {
    const everyDay = [
      minutes('2026-08-31', 240),
      minutes('2026-09-01', 240),
      minutes('2026-09-02', 240),
      minutes('2026-09-03', 240)
    ];
    expect(relayMemberUnits(everyDay, weekStart, relayRule)).toBe(600);
  });

  it('counts nothing for a member who did not move', () => {
    expect(relayMemberUnits([], weekStart, relayRule)).toBe(0);
  });
});

describe('relay progress', () => {
  it('reports whole percentages of the shared target', () => {
    expect(relayProgressPercent(0, 600)).toBe(0);
    expect(relayProgressPercent(150, 600)).toBe(25);
    expect(relayProgressPercent(600, 600)).toBe(100);
  });

  it('clamps past the target rather than inviting comparison', () => {
    expect(relayProgressPercent(1200, 600)).toBe(100);
  });

  it('never divides by a target of zero', () => {
    expect(relayProgressPercent(50, 0)).toBe(0);
    expect(relayGoalMet(50, 0)).toBe(false);
  });

  it('is met once the total reaches the target', () => {
    expect(relayGoalMet(599, 600)).toBe(false);
    expect(relayGoalMet(600, 600)).toBe(true);
    expect(relayGoalMet(601, 600)).toBe(true);
  });
});

describe('club challenge rules', () => {
  const rule = parseChallengeRule({
    dailyCapMinutes: 240,
    minMinutesPerActiveDay: 1,
    lengthDays: [7, 14],
    modes: ['active_minutes', 'active_days']
  });

  it('lets an owner or admin open a contest, and nobody else', () => {
    expect(canManageClubChallenge('owner')).toBe(true);
    expect(canManageClubChallenge('admin')).toBe(true);
    expect(canManageClubChallenge('member')).toBe(false);
  });

  it('reads the same published shape as the 1v1 challenge rule', () => {
    expect(clubChallengeModeEnabled(rule, 'active_minutes')).toBe(true);
    expect(clubChallengeModeEnabled(rule, 'active_days')).toBe(true);
    // Nothing records a quest completion, so no rule enables scoring one.
    expect(clubChallengeModeEnabled(rule, 'quest_completion')).toBe(false);
  });

  it('allows only the published lengths', () => {
    expect(clubChallengeLengthEnabled(rule, 7)).toBe(true);
    expect(clubChallengeLengthEnabled(rule, 14)).toBe(true);
    expect(clubChallengeLengthEnabled(rule, 3)).toBe(false);
    expect(clubChallengeLengthEnabled(rule, 30)).toBe(false);
  });

  it('treats a closed contest as history rather than something to join', () => {
    expect(clubChallengeOpen('active')).toBe(true);
    expect(clubChallengeOpen('finished')).toBe(false);
    expect(clubChallengeOpen('cancelled')).toBe(false);
  });
});
