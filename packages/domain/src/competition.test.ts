import { describe, expect, it } from 'vitest';
import {
  canOperateCompetitions,
  competitionDisputeEndsAt,
  competitionEligible,
  competitionEnrollmentOpen,
  competitionResultsProvisional,
  competitionStatusDue,
  competitionVisibleToMembers
} from './competition.js';

const OPENS = new Date('2026-09-07T00:00:00.000Z');
const CLOSES = new Date('2026-09-14T00:00:00.000Z');

const competition = (overrides: Partial<Parameters<typeof competitionStatusDue>[0]> = {}) => ({
  status: 'published' as const,
  opensAt: OPENS,
  closesAt: CLOSES,
  disputePeriodHours: 48,
  ...overrides
});

describe('who may run a competition', () => {
  it('is the season operator and the admin, and nobody else', () => {
    expect(canOperateCompetitions(['season_operator'])).toBe(true);
    expect(canOperateCompetitions(['admin'])).toBe(true);
    expect(canOperateCompetitions(['moderator', 'support'])).toBe(false);
    expect(canOperateCompetitions([])).toBe(false);
  });
});

describe('what members can see and enter', () => {
  it('hides a draft and shows everything that was announced', () => {
    expect(competitionVisibleToMembers('draft')).toBe(false);
    // A cancelled event was announced, so it stays visible: people arranged
    // their weeks around it.
    expect(competitionVisibleToMembers('cancelled')).toBe(true);
    expect(competitionVisibleToMembers('published')).toBe(true);
    expect(competitionVisibleToMembers('finalized')).toBe(true);
  });

  it('accepts entries from announcement until the window closes', () => {
    expect(competitionEnrollmentOpen('published')).toBe(true);
    expect(competitionEnrollmentOpen('open')).toBe(true);
    expect(competitionEnrollmentOpen('closed')).toBe(false);
    expect(competitionEnrollmentOpen('finalized')).toBe(false);
    expect(competitionEnrollmentOpen('cancelled')).toBe(false);
    expect(competitionEnrollmentOpen('draft')).toBe(false);
  });

  it('measures eligibility in whole earlier active weeks', () => {
    expect(competitionEligible(0, 0)).toBe(true);
    expect(competitionEligible(3, 4)).toBe(false);
    expect(competitionEligible(4, 4)).toBe(true);
    expect(competitionEligible(-2, 0)).toBe(true);
    expect(competitionEligible(4.9, 5)).toBe(false);
  });
});

describe('the clock, not a person, moves a competition', () => {
  it('opens an announced competition when its window starts', () => {
    expect(
      competitionStatusDue(competition(), new Date('2026-09-06T23:00:00.000Z'))
    ).toBeUndefined();
    expect(competitionStatusDue(competition(), new Date('2026-09-07T00:00:00.000Z'))).toBe('open');
  });

  it('closes a running competition when its window ends', () => {
    expect(
      competitionStatusDue(competition({ status: 'open' }), new Date('2026-09-13T23:00:00.000Z'))
    ).toBeUndefined();
    expect(
      competitionStatusDue(competition({ status: 'open' }), new Date('2026-09-14T00:00:00.000Z'))
    ).toBe('closed');
  });

  it('lands correctly when a whole window passed with nobody sweeping', () => {
    // Announced, never opened, and the window has already ended: the next
    // check moves it straight to closed rather than opening it for a day that
    // is gone.
    expect(competitionStatusDue(competition(), new Date('2026-09-20T00:00:00.000Z'))).toBe(
      'closed'
    );
  });

  it('finalizes only once the stated dispute period has elapsed', () => {
    const closed = competition({ status: 'closed', closedAt: CLOSES });
    expect(competitionStatusDue(closed, new Date('2026-09-15T23:00:00.000Z'))).toBeUndefined();
    expect(competitionStatusDue(closed, new Date('2026-09-16T00:00:00.000Z'))).toBe('finalized');
  });

  it('finalizes immediately when no dispute period was published', () => {
    const closed = competition({ status: 'closed', closedAt: CLOSES, disputePeriodHours: 0 });
    expect(competitionStatusDue(closed, CLOSES)).toBe('finalized');
  });

  it('never revives a cancelled or finalized competition', () => {
    const later = new Date('2027-01-01T00:00:00.000Z');
    expect(competitionStatusDue(competition({ status: 'cancelled' }), later)).toBeUndefined();
    expect(competitionStatusDue(competition({ status: 'finalized' }), later)).toBeUndefined();
  });

  it('never publishes a draft, because announcing is a staff decision', () => {
    expect(
      competitionStatusDue(competition({ status: 'draft' }), new Date('2027-01-01T00:00:00.000Z'))
    ).toBeUndefined();
  });
});

describe('the dispute period', () => {
  it('starts at the close and is only known once the window has closed', () => {
    expect(competitionDisputeEndsAt(undefined, 48)).toBeUndefined();
    expect(competitionDisputeEndsAt(CLOSES, 48)?.toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('is what makes a stored result provisional rather than final', () => {
    expect(competitionResultsProvisional('closed')).toBe(true);
    expect(competitionResultsProvisional('finalized')).toBe(false);
    expect(competitionResultsProvisional('open')).toBe(false);
  });
});
