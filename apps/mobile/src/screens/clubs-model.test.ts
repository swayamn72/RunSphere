import { describe, expect, it } from 'vitest';
import type { Club, ClubMember, ClubRelaySummary, ClubRole } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';
import {
  ARCHIVE_CONSEQUENCE,
  RELAY_EXPLANATION,
  canSetRelayTarget,
  clubActions,
  clubListState,
  clubMemberRows,
  clubRows,
  clubsErrorState,
  clubsStatusMessage,
  createFailureNotice,
  joinFailureNotice,
  leaveFailureNotice,
  moderationFailureNotice,
  currentRelay,
  relayFailureNotice,
  relayRows,
  validateClubName,
  validateRelayTarget
} from './clubs-model';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';

const club = (overrides: Partial<Club> = {}): Club => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Morning Movers',
  role: 'member',
  memberCount: 4,
  inviteCode: 'ABCDEFGHJK',
  ...overrides
});

const member = (accountId: string, role: ClubRole, displayName: string): ClubMember => ({
  profile: {
    id: accountId,
    displayName,
    cosmetic: { avatarKey: 'loop-1' },
    activityVisibility: 'private'
  },
  role,
  joinedAt: '2026-09-01T10:00:00.000Z'
});

describe('club rows', () => {
  it('states the role and size for a screen reader', () => {
    const [row] = clubRows([club({ role: 'admin', memberCount: 1 })]);
    expect(row!.roleLabel).toBe('Admin');
    expect(row!.memberLabel).toBe('1 member');
    expect(row!.accessibilityLabel).toBe('Morning Movers. Admin. 1 member.');
  });

  it('pluralises the member count', () => {
    expect(clubRows([club({ memberCount: 4 })])[0]!.memberLabel).toBe('4 members');
  });
});

describe('member rows', () => {
  const members = [
    member(RAVI, 'member', 'Ravi'),
    member(ME, 'owner', 'Maya'),
    member('00000000-0000-4000-8000-00000000000c', 'admin', 'Ana')
  ];

  it('reads as the authority ladder: owner, admins, then members', () => {
    const rows = clubMemberRows(members, { accountId: ME, role: 'owner' });
    expect(rows.map((row) => row.roleLabel)).toEqual(['Owner', 'Admin', 'Member']);
  });

  it('marks the reader own row and never offers actions on it', () => {
    const rows = clubMemberRows(members, { accountId: ME, role: 'owner' });
    const self = rows.find((row) => row.isSelf)!;
    expect(self.accessibilityLabel).toContain('This is you');
    expect(self.canRemove).toBe(false);
    expect(self.nextRole).toBeUndefined();
  });

  it('offers an owner promotion and removal, matching what the route allows', () => {
    const rows = clubMemberRows(members, { accountId: ME, role: 'owner' });
    const plain = rows.find((row) => row.nameLabel === 'Ravi')!;
    expect(plain.canRemove).toBe(true);
    expect(plain.nextRole).toBe('admin');
    const admin = rows.find((row) => row.nameLabel === 'Ana')!;
    expect(admin.nextRole).toBe('member');
  });

  it('offers an admin removal of members only, and no role changes', () => {
    const rows = clubMemberRows(members, { accountId: RAVI, role: 'admin' });
    expect(rows.find((row) => row.nameLabel === 'Ravi')!.canRemove).toBe(false);
    expect(rows.find((row) => row.nameLabel === 'Ana')!.canRemove).toBe(false);
    expect(rows.every((row) => row.nextRole === undefined)).toBe(true);
  });

  it('offers a plain member nothing at all', () => {
    const rows = clubMemberRows(members, { accountId: RAVI, role: 'member' });
    expect(rows.every((row) => !row.canRemove && row.nextRole === undefined)).toBe(true);
  });

  it('keeps a member with no display name addressable', () => {
    const rows = clubMemberRows([member(RAVI, 'member', '')], { accountId: ME, role: 'owner' });
    expect(rows[0]!.nameLabel).toBe('RunSphere member');
  });
});

describe('club actions', () => {
  it('lets a member leave and offers no archive', () => {
    expect(clubActions(club({ role: 'member' }))).toEqual({
      canLeave: true,
      canArchive: false,
      leaveBlockedReason: undefined
    });
  });

  it('explains why an owner of a populated club cannot leave', () => {
    const actions = clubActions(club({ role: 'owner', memberCount: 3 }));
    expect(actions.canLeave).toBe(false);
    expect(actions.leaveBlockedReason).toContain('archive it before leaving');
    expect(actions.canArchive).toBe(true);
  });

  it('lets the last owner leave', () => {
    expect(clubActions(club({ role: 'owner', memberCount: 1 })).canLeave).toBe(true);
  });

  it('says what archiving costs before it is offered', () => {
    expect(ARCHIVE_CONSEQUENCE).toContain('every member, including you');
    expect(ARCHIVE_CONSEQUENCE).toContain('kept');
  });
});

describe('club name', () => {
  it('trims and collapses whitespace', () => {
    expect(validateClubName('  Morning   Movers ')).toEqual({ ok: true, name: 'Morning Movers' });
  });

  it('requires a name and holds the 80-character contract limit', () => {
    expect(validateClubName('   ')).toMatchObject({ ok: false });
    expect(validateClubName('a'.repeat(80))).toMatchObject({ ok: true });
    expect(validateClubName('a'.repeat(81))).toMatchObject({ ok: false });
  });
});

describe('failure notices', () => {
  it('treats a wrong code and an archived club identically, as the route does', () => {
    expect(joinFailureNotice(new ApiFailure(404, 'Club not found'))).toBe(
      'No club matches that code. Check it with whoever sent it.'
    );
  });

  it('names the already-a-member case', () => {
    expect(joinFailureNotice(new ApiFailure(409, 'Already a member of this club'))).toContain(
      'already a member'
    );
  });

  it('explains the owner leave conflict rather than reporting a failure', () => {
    expect(leaveFailureNotice(new ApiFailure(409, 'nope'))).toContain('archive it before leaving');
  });

  it('says nothing changed for every other failure', () => {
    expect(joinFailureNotice(new Error('boom'))).toContain('Nothing changed');
    expect(leaveFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(moderationFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(moderationFailureNotice(new Error('boom'))).toContain('Nothing changed');
    expect(createFailureNotice(new Error('boom'))).toContain('Nothing was created');
  });

  it('reports a refused moderation action as a role limit, not a bug', () => {
    expect(moderationFailureNotice(new ApiFailure(403, 'no'))).toContain('does not allow that');
    expect(moderationFailureNotice(new ApiFailure(404, 'no'))).toContain('no longer in the club');
  });
});

describe('state and status', () => {
  it('is empty until the account is in a club', () => {
    expect(clubListState([])).toBe('empty');
    expect(clubListState([club()])).toBe('ready');
  });

  it('maps transport failures the way every other screen does', () => {
    expect(clubsErrorState(new AuthFailure('network'))).toBe('offline');
    expect(clubsErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(clubsErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(clubsErrorState(new Error('boom'))).toBe('error');
  });

  it('announces a notice first, then the count', () => {
    expect(clubsStatusMessage('ready', 'Joined Morning Movers.', 2)).toBe('Joined Morning Movers.');
    expect(clubsStatusMessage('ready', '', 1)).toBe('One club.');
    expect(clubsStatusMessage('ready', '', 3)).toBe('3 clubs.');
    expect(clubsStatusMessage('offline', '', 0)).toContain('offline');
  });
});

const relay = (overrides: Partial<ClubRelaySummary> = {}): ClubRelaySummary => ({
  id: 'relay-1',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-07',
  targetUnits: 600,
  totalUnits: 450,
  myUnits: 75,
  contributorCount: 3,
  progressPercent: 75,
  goalMet: false,
  current: true,
  ruleVersion: 1,
  ...overrides
});

describe('relay rows', () => {
  it('states the club total against the target and the reader own share', () => {
    const [row] = relayRows([relay()]);
    expect(row!.weekLabel).toBe('This week');
    expect(row!.totalLabel).toBe('450 minutes of 600');
    expect(row!.myLabel).toBe('You added 75 minutes');
    expect(row!.contributorLabel).toBe('3 members contributed');
    expect(row!.statusLabel).toBe('In progress');
  });

  it('names a past week by its start rather than calling it current', () => {
    const [row] = relayRows([relay({ current: false, periodStart: '2026-08-24' })]);
    expect(row!.weekLabel).toBe('Week of 2026-08-24');
    expect(row!.statusLabel).toBe('Target not met');
  });

  it('reports a met target the same way whether or not the week is open', () => {
    expect(relayRows([relay({ goalMet: true })])[0]!.statusLabel).toBe('Target met');
    expect(relayRows([relay({ goalMet: true, current: false })])[0]!.statusLabel).toBe(
      'Target met'
    );
  });

  it('pluralises a single minute and a single contributor', () => {
    const [row] = relayRows([relay({ totalUnits: 1, myUnits: 1, contributorCount: 1 })]);
    expect(row!.totalLabel).toBe('1 minute of 600');
    expect(row!.myLabel).toBe('You added 1 minute');
    expect(row!.contributorLabel).toBe('1 member contributed');
  });

  it('announces the week as one unit, with the percentage first', () => {
    const [row] = relayRows([relay()]);
    expect(row!.accessibilityLabel).toBe(
      'This week. 75 percent of the club target. 450 minutes of 600. 3 members contributed. You added 75 minutes. In progress.'
    );
  });

  it('carries no field from which another member share could be derived', () => {
    const [row] = relayRows([relay()]);
    expect(Object.keys(row!)).toEqual([
      'id',
      'weekLabel',
      'progressPercent',
      'totalLabel',
      'myLabel',
      'contributorLabel',
      'statusLabel',
      'current',
      'accessibilityLabel'
    ]);
  });

  it('picks the open week out of the list, or nothing when none is open', () => {
    expect(currentRelay([relay({ current: false }), relay({ id: 'r2' })])?.id).toBe('r2');
    expect(currentRelay([relay({ current: false })])).toBeUndefined();
    expect(currentRelay([])).toBeUndefined();
  });
});

describe('relay authority in the tab', () => {
  it('matches the route: owner and admin only', () => {
    expect(canSetRelayTarget('owner')).toBe(true);
    expect(canSetRelayTarget('admin')).toBe(true);
    expect(canSetRelayTarget('member')).toBe(false);
  });

  it('explains that a relay is cooperative and shows no individual minutes', () => {
    expect(RELAY_EXPLANATION).toContain('takes several people rather than one');
    expect(RELAY_EXPLANATION).toContain('only the club total');
  });
});

describe('relay target validation', () => {
  it('accepts a whole number inside the published bounds', () => {
    expect(validateRelayTarget(' 600 ')).toEqual({ ok: true, targetUnits: 600 });
    expect(validateRelayTarget('60')).toMatchObject({ ok: true });
    expect(validateRelayTarget('20000')).toMatchObject({ ok: true });
  });

  it('rejects anything the published rule would refuse', () => {
    expect(validateRelayTarget('59')).toMatchObject({ ok: false });
    expect(validateRelayTarget('20001')).toMatchObject({ ok: false });
    expect(validateRelayTarget('600.5')).toMatchObject({ ok: false });
    expect(validateRelayTarget('lots')).toMatchObject({ ok: false });
    expect(validateRelayTarget('')).toMatchObject({ ok: false });
  });

  it('passes a 422 message through, because the server states the real bounds', () => {
    expect(relayFailureNotice(new ApiFailure(422, 'No club relay rule is published'))).toBe(
      'No club relay rule is published'
    );
  });

  it('names the role limit and says nothing changed otherwise', () => {
    expect(relayFailureNotice(new ApiFailure(403, 'no'))).toContain('owner or admin');
    expect(relayFailureNotice(new AuthFailure('network'))).toContain('Nothing changed');
    expect(relayFailureNotice(new Error('boom'))).toContain('Nothing changed');
  });
});
