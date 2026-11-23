import type { Profile, ProgressionSummary, WeeklyGoalResponse } from '@runsphere/contracts';

/**
 * Presentation for the Home dashboard: the greeting, the active-days meter,
 * and the weekly summary tiles.
 *
 * Every number here is copied from a server response. Two absences are
 * deliberate rather than oversights:
 *
 * - **No day streak.** The progression summary reports how many days of the
 *   current week were active and never which ones, and there is no
 *   consecutive-day count anywhere in the API. A "12 day streak" would be
 *   invented, so the card counts this week's active days instead.
 * - **No calories.** Nothing in the product measures energy, and a figure
 *   derived from distance would be a guess presented as a measurement.
 *
 * `questsCompleted` is also kept out, for the reason `home-progression-model`
 * gives: `/v1/progression` still answers a hardcoded `0`.
 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export const timeOfDay = (hour: number): TimeOfDay => {
  if (!Number.isFinite(hour)) return 'morning';
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  if (normalized < 12) return 'morning';
  if (normalized < 17) return 'afternoon';
  return 'evening';
};

const GREETING: Readonly<Record<TimeOfDay, string>> = {
  morning: 'Good morning,',
  afternoon: 'Good afternoon,',
  evening: 'Good evening,'
};

export interface GreetingPresentation {
  readonly salutation: string;
  /** The reader's own name, or a neutral stand-in until the profile arrives. */
  readonly name: string;
  /** Monogram for the header avatar; never a letter from an absent profile. */
  readonly initials: string;
}

const initialsOf = (displayName: string): string => {
  const words = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = words.map((word) => [...word][0] ?? '').join('');
  return letters ? letters.toUpperCase() : '·';
};

export const greetingPresentation = (
  profile: Profile | undefined,
  hour: number
): GreetingPresentation => {
  const name = profile?.displayName?.trim();
  return {
    salutation: GREETING[timeOfDay(hour)],
    name: name ? `${name}!` : 'Runner!',
    initials: name ? initialsOf(name) : '·'
  };
};

/** Grouped thousands without Intl, so Hermes builds format identically to tests. */
const grouped = (value: number): string =>
  Math.trunc(Math.max(0, value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface ActiveDaysPresentation {
  readonly value: string;
  readonly caption: string;
  /**
   * One entry per day of the week, filled from the left. A count meter, not a
   * calendar: the fill says how many days were active, never which.
   */
  readonly pips: readonly { readonly index: number; readonly active: boolean }[];
  readonly accessibilityLabel: string;
}

const DAYS_IN_WEEK = 7;

export const activeDaysPresentation = (
  summary: ProgressionSummary | undefined
): ActiveDaysPresentation | undefined => {
  const consistency = summary?.weeklyConsistency;
  if (!consistency) return undefined;
  const active = Math.max(0, Math.min(DAYS_IN_WEEK, consistency.activeDays));
  return {
    value: `${active}`,
    caption: active === 1 ? 'active day' : 'active days',
    pips: Array.from({ length: DAYS_IN_WEEK }, (_, index) => ({
      index,
      active: index < active
    })),
    // Spoken as a count so a screen reader is never told a specific weekday
    // was active, which the server does not report.
    accessibilityLabel: `${active} of ${DAYS_IN_WEEK} days active this week.`
  };
};

/** A tile in the weekly summary grid. */
export interface DashboardTile {
  readonly key: 'distance' | 'active-minutes';
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
}

/**
 * The tiles whose values are known. A tile is omitted rather than zeroed when
 * its source has not loaded, so the grid never reports 0 km for "still
 * loading".
 */
export const dashboardTiles = (goal: WeeklyGoalResponse | undefined): readonly DashboardTile[] => {
  const tiles: DashboardTile[] = [];
  if (goal)
    tiles.push(
      {
        key: 'distance',
        label: 'Distance',
        value: (goal.distanceMeters.actual / 1000).toFixed(1),
        suffix: 'km'
      },
      {
        key: 'active-minutes',
        label: 'Active time',
        value: grouped(goal.activeMinutes.actual),
        suffix: 'min'
      }
    );
  return tiles;
};
