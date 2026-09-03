import type { ChallengeMode, WeeklyConsistency } from '@runsphere/contracts';

/**
 * Asia/Kolkata is fixed UTC+05:30 and observes no daylight saving. Every weekly
 * and local-day boundary is derived from this constant offset plus the
 * Asia/Kolkata calendar date, so scoring is reproducible for audits (ADR-0006)
 * with no timezone database, client clock, or DST-rule dependence.
 */
export const KOLKATA_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 19_800_000
export const MILLIS_PER_DAY = 86_400_000;

/**
 * Provisional cosmetic day cap. Gamification is pace-neutral and cosmetic only
 * (ADR-0005), so a single generous per-day cap prevents one long submission
 * from dominating a period. This default is a placeholder: the published rule
 * version for each feature is authoritative and may override it.
 */
export const DAILY_VALIDATED_ACTIVE_MINUTES_CAP = 240; // 4 hours per local day

/** An activity reduced to the fields gamification scoring is allowed to read. */
export interface ScoredActivity {
  /** Server-derived validated active duration in whole seconds. */
  activeDurationSeconds: number;
  /** Server-set end timestamp. Client clocks are never trusted (ADR-0006). */
  endedAt: Date | string;
}

/** A quest-completion event, reduced to the instant it was recorded server-side. */
export interface QuestCompletion {
  completedAt: Date | string;
}

/** An inclusive start and exclusive end pair for a scoring window. */
export interface ScoringWindow {
  periodStart: Date;
  periodEnd: Date;
}

export interface WeeklyConsistencyOptions {
  /** Observation instant; defaults to the current wall-clock time. */
  now?: Date;
  /** Explicit Kolkata Monday 00:00 week. Defaults to the week containing `now`. */
  periodStart?: Date;
  /** Per-local-day active minute cap. Defaults to `DAILY_VALIDATED_ACTIVE_MINUTES_CAP`. */
  dailyCapMinutes?: number;
  /** Optional published active-day goal surfaced on the card. */
  goalActiveDays?: number;
  /** Whole validated minutes required to count a day as active. Defaults to 1. */
  minMinutesPerActiveDay?: number;
}

const KOLKATA_CALENDAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function kolkataCalendarDate(instant: Date): CalendarDate {
  const parts = KOLKATA_CALENDAR_FORMATTER.formatToParts(instant);
  const read = (type: 'year' | 'month' | 'day'): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Intl date part '${type}' missing for Asia/Kolkata`);
    }
    return Number(part.value);
  };
  return { year: read('year'), month: read('month'), day: read('day') };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` calendar date in Asia/Kolkata for `instant`. */
export function kolkataDate(instant: Date): string {
  const { year, month, day } = kolkataCalendarDate(instant);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** UTC instant of Asia/Kolkata 00:00 for the calendar day containing `instant`. */
export function kolkataDayStart(instant: Date): Date {
  const { year, month, day } = kolkataCalendarDate(instant);
  return new Date(Date.UTC(year, month - 1, day) - KOLKATA_OFFSET_MS);
}

/**
 * UTC instant of Asia/Kolkata 00:00 for a `YYYY-MM-DD` calendar date. This is
 * the inverse of `kolkataDate`, so a persisted `date` column round-trips back
 * to the exact instant its scoring window opened.
 */
export function kolkataDateStart(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Expected a YYYY-MM-DD Asia/Kolkata date, received '${date}'`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = Date.UTC(year, month - 1, day) - KOLKATA_OFFSET_MS;
  if (!Number.isFinite(instant)) throw new Error(`Invalid Asia/Kolkata date '${date}'`);
  return new Date(instant);
}

const EPOCH_WEEKDAY_SUNDAY0 = 4; // 1970-01-01 was a Thursday (0 = Sunday)

function mod(numerator: number, modulus: number): number {
  return ((numerator % modulus) + modulus) % modulus;
}

/** Weekday of a Kolkata calendar date, 0 = Sunday … 6 = Saturday. */
function weekdaySunday0(date: CalendarDate): number {
  const utcDayIndex = Date.UTC(date.year, date.month - 1, date.day) / MILLIS_PER_DAY;
  return mod(utcDayIndex + EPOCH_WEEKDAY_SUNDAY0, 7);
}

/**
 * UTC instant of Asia/Kolkata Monday 00:00 for the week containing `instant`.
 * The Monday date is found in the calendar domain (from Asia/Kolkata date
 * parts) and converted back to a UTC instant by subtracting the fixed offset.
 */
export function weeklyPeriodStart(instant: Date): Date {
  const date = kolkataCalendarDate(instant);
  const daysSinceMonday = mod(weekdaySunday0(date) + 6, 7); // Monday = 0
  const mondayUtcMidnight = Date.UTC(date.year, date.month - 1, date.day - daysSinceMonday);
  return new Date(mondayUtcMidnight - KOLKATA_OFFSET_MS);
}

function toTimestamp(value: Date | string): number {
  return typeof value === 'string' ? Date.parse(value) : value.getTime();
}

/**
 * Whole validated active minutes per Asia/Kolkata calendar date, floored from
 * seconds. Non-positive durations contribute nothing and are never subtracted.
 */
export function dailyValidatedActiveMinutes(
  activities: readonly ScoredActivity[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const date = kolkataDate(new Date(toTimestamp(activity.endedAt)));
    const minutes = Math.floor(Math.max(0, activity.activeDurationSeconds) / 60);
    totals.set(date, (totals.get(date) ?? 0) + minutes);
  }
  return totals;
}

/**
 * Sum of validated active minutes within `[periodStart, periodEnd)`, capped per
 * local day. Daily totals are floored to whole minutes before the cap applies,
 * and cannot be negative.
 */
export function cappedActiveMinutes(
  activities: readonly ScoredActivity[],
  periodStart: Date,
  periodEnd: Date,
  dailyCapMinutes: number
): number {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  const daily = new Map<string, number>();
  for (const activity of activities) {
    const timestamp = toTimestamp(activity.endedAt);
    if (timestamp < startMs || timestamp >= endMs) continue;
    const date = kolkataDate(new Date(timestamp));
    const minutes = Math.floor(Math.max(0, activity.activeDurationSeconds) / 60);
    daily.set(date, (daily.get(date) ?? 0) + minutes);
  }
  let total = 0;
  const cap = Math.max(0, dailyCapMinutes);
  for (const minutes of daily.values()) {
    total += Math.min(minutes, cap);
  }
  return total;
}

/** `cappedActiveMinutes` over the full seven-day week starting at `weeklyStart`. */
export function cappedWeeklyActiveMinutes(
  activities: readonly ScoredActivity[],
  weeklyStart: Date,
  dailyCapMinutes: number
): number {
  return cappedActiveMinutes(
    activities,
    weeklyStart,
    new Date(weeklyStart.getTime() + 7 * MILLIS_PER_DAY),
    dailyCapMinutes
  );
}

/**
 * Number of distinct Asia/Kolkata dates within `[periodStart, periodEnd)` whose
 * validated active minutes reach `minMinutesPerActiveDay` (default 1). A day is
 * counted at most once regardless of how many activities it holds.
 */
export function activeDayCount(
  activities: readonly ScoredActivity[],
  periodStart: Date,
  periodEnd: Date,
  minMinutesPerActiveDay = 1
): number {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  const daily = new Map<string, number>();
  for (const activity of activities) {
    const timestamp = toTimestamp(activity.endedAt);
    if (timestamp < startMs || timestamp >= endMs) continue;
    const date = kolkataDate(new Date(timestamp));
    const minutes = Math.floor(Math.max(0, activity.activeDurationSeconds) / 60);
    daily.set(date, (daily.get(date) ?? 0) + minutes);
  }
  let days = 0;
  for (const minutes of daily.values()) {
    if (minutes >= minMinutesPerActiveDay) days += 1;
  }
  return days;
}

/** `activeDayCount` over the full seven-day week starting at `weeklyStart`. */
export function weeklyActiveDayCount(
  activities: readonly ScoredActivity[],
  weeklyStart: Date,
  minMinutesPerActiveDay = 1
): number {
  return activeDayCount(
    activities,
    weeklyStart,
    new Date(weeklyStart.getTime() + 7 * MILLIS_PER_DAY),
    minMinutesPerActiveDay
  );
}

/**
 * Build the optional weekly consistency card (ADR-0005). Missed days never
 * reduce lifetime progress; the card is a non-punitive snapshot of the current
 * (or a specified) week.
 */
export function weeklyConsistency(
  activities: readonly ScoredActivity[],
  options: WeeklyConsistencyOptions = {}
): WeeklyConsistency {
  const now = options.now ?? new Date();
  const start = options.periodStart ?? weeklyPeriodStart(now);
  const end = new Date(start.getTime() + 7 * MILLIS_PER_DAY);
  const dailyCap = options.dailyCapMinutes ?? DAILY_VALIDATED_ACTIVE_MINUTES_CAP;
  const minMinutes = options.minMinutesPerActiveDay ?? 1;

  const card: WeeklyConsistency = {
    periodStart: kolkataDate(start),
    activeDays: activeDayCount(activities, start, end, minMinutes),
    cappedActiveMinutes: cappedActiveMinutes(activities, start, end, dailyCap),
    current: now.getTime() >= start.getTime() && now.getTime() < end.getTime()
  };
  if (options.goalActiveDays !== undefined) {
    card.goalActiveDays = options.goalActiveDays;
  }
  return card;
}

/** Number of quest completions within `[periodStart, periodEnd)`. */
export function questCompletionCount(
  completions: readonly QuestCompletion[],
  periodStart: Date,
  periodEnd: Date
): number {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  let count = 0;
  for (const completion of completions) {
    const timestamp = toTimestamp(completion.completedAt);
    if (timestamp >= startMs && timestamp < endMs) count += 1;
  }
  return count;
}

/**
 * Score a 1v1 challenge result by mode (pace-neutral; never pace or distance).
 * `quest_completion` counts completions; the other modes are derived from
 * validated activities only.
 */
export function challengeModeScore(
  mode: ChallengeMode,
  window: ScoringWindow,
  activities: readonly ScoredActivity[],
  completions: readonly QuestCompletion[],
  dailyCapMinutes: number,
  minMinutesPerActiveDay = 1
): number {
  switch (mode) {
    case 'active_minutes':
      return cappedActiveMinutes(activities, window.periodStart, window.periodEnd, dailyCapMinutes);
    case 'active_days':
      return activeDayCount(
        activities,
        window.periodStart,
        window.periodEnd,
        minMinutesPerActiveDay
      );
    case 'quest_completion':
      return questCompletionCount(completions, window.periodStart, window.periodEnd);
  }
}

/**
 * A challenge window is `lengthDays` Asia/Kolkata calendar days starting at
 * 00:00 on `periodStart`, so both participants are scored over exactly the same
 * instants regardless of device timezone.
 */
export function challengeWindow(periodStart: string, lengthDays: number): ScoringWindow {
  if (!Number.isInteger(lengthDays) || lengthDays < 1) {
    throw new Error(`Challenge length must be a positive whole number of days`);
  }
  const start = kolkataDateStart(periodStart);
  return {
    periodStart: start,
    periodEnd: new Date(start.getTime() + lengthDays * MILLIS_PER_DAY)
  };
}

/**
 * Competition ranking over scores already ordered highest-first: equal scores
 * share a rank and the next distinct score skips the consumed positions
 * (1, 2, 2, 4). Ties are shared rather than broken, because the only available
 * tiebreaks would be pace, distance, or timing, none of which a board may read
 * (ADR-0007).
 */
export function competitionRanking(descendingScores: readonly number[]): number[] {
  const ranks: number[] = [];
  let currentRank = 0;
  let previousScore: number | undefined;
  descendingScores.forEach((score, index) => {
    if (previousScore === undefined || score !== previousScore) currentRank = index + 1;
    previousScore = score;
    ranks.push(currentRank);
  });
  return ranks;
}

export interface ChallengeParticipantScore {
  accountId: string;
  score: number;
}

/**
 * The higher pace-neutral score wins. An exact tie has no winner rather than a
 * tiebreak on time, pace, or distance, none of which a challenge may read.
 */
export function challengeWinner(
  participants: readonly ChallengeParticipantScore[]
): string | undefined {
  let best: ChallengeParticipantScore | undefined;
  let tied = false;
  for (const participant of participants) {
    if (!best || participant.score > best.score) {
      best = participant;
      tied = false;
    } else if (participant.score === best.score && participant.accountId !== best.accountId) {
      tied = true;
    }
  }
  return tied ? undefined : best?.accountId;
}
