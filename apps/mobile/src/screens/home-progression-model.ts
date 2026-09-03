import type { Profile, ProgressionSummary } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';

/**
 * Home progression presentation (ADR-0005). Every number here is copied from a
 * server `ProgressionSummary`; this module never accumulates, projects, or
 * estimates XP, levels, or active days. `summary.questsCompleted` is
 * deliberately not presented: the `/v1/progression` route still returns a
 * hardcoded `0`, so showing it would render a fabricated zero.
 */
export type ProgressionCardState =
  | 'loading'
  | 'ready'
  | 'unpublished'
  | 'unavailable'
  | 'offline'
  | 'error'
  | 'configuration'
  | 'session-expired';

/** Cosmetic level band for the current XP total. */
export interface LevelPresentation {
  readonly levelLabel: string;
  readonly xpInLevelLabel: string;
  /** Percentage across the current level band; omitted when no band is known. */
  readonly progress: number | undefined;
  readonly terminal: boolean;
  readonly progressAccessibilityLabel: string;
}

export interface ProgressionPresentation {
  readonly totalXpLabel: string;
  readonly level: LevelPresentation | undefined;
  /** Server-owned cosmetic tier from the profile; decoration only. */
  readonly tierLabel: string | undefined;
}

export interface ConsistencyPip {
  readonly index: number;
  readonly active: boolean;
}

export interface ConsistencyPresentation {
  readonly weekLabel: string;
  readonly pips: readonly ConsistencyPip[];
  readonly activeDaysLabel: string;
  readonly goalLabel: string | undefined;
  readonly cappedMinutesLabel: string;
  readonly accessibilityLabel: string;
  readonly reassurance: string;
}

const DAYS_IN_WEEK = 7;

/** Grouped thousands without Intl, so Hermes builds format identically to tests. */
const grouped = (value: number): string =>
  Math.trunc(Math.max(0, value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

/** A published progression rule is what produces `level`; without one there is nothing to band. */
export const progressionCardState = (summary: ProgressionSummary): ProgressionCardState =>
  summary.level ? 'ready' : 'unpublished';

/**
 * A `503` means progression is not enabled on this deployment, which is not the
 * same as a request that failed and should be retried differently.
 */
export const progressionErrorState = (
  error: unknown
): Extract<
  ProgressionCardState,
  'unavailable' | 'offline' | 'error' | 'configuration' | 'session-expired'
> => {
  if (error instanceof AuthFailure) {
    if (error.kind === 'network' || error.kind === 'tls') return 'offline';
    if (error.kind === 'configuration') return 'configuration';
    if (error.kind === 'invalid-credentials') return 'session-expired';
    return 'error';
  }
  if (error instanceof ApiFailure && error.status === 503) return 'unavailable';
  return 'error';
};

/**
 * `nextLevelAt` is the next band's cumulative threshold, so the band width is
 * `nextLevelAt - (totalXp - xpInLevel)`. A non-positive width means the served
 * rule and totals disagree; the bar is dropped rather than rendered from a
 * divide-by-zero or negative width.
 */
export const levelPresentation = (summary: ProgressionSummary): LevelPresentation | undefined => {
  const level = summary.level;
  if (!level) return undefined;
  const levelLabel = `Level ${level.level}`;
  const bandStart = summary.totalXp - level.xpInLevel;
  const bandWidth = level.nextLevelAt === undefined ? undefined : level.nextLevelAt - bandStart;
  if (bandWidth === undefined)
    return {
      levelLabel,
      xpInLevelLabel: `${grouped(level.xpInLevel)} XP at the top published level`,
      progress: undefined,
      terminal: true,
      progressAccessibilityLabel: `${levelLabel}, top published level`
    };
  if (bandWidth <= 0)
    return {
      levelLabel,
      xpInLevelLabel: `${grouped(level.xpInLevel)} XP in this level`,
      progress: undefined,
      terminal: false,
      progressAccessibilityLabel: `${levelLabel}, level progress unavailable`
    };
  const progress = clampPercent((level.xpInLevel / bandWidth) * 100);
  return {
    levelLabel,
    xpInLevelLabel: `${grouped(level.xpInLevel)} of ${grouped(bandWidth)} XP to level ${level.level + 1}`,
    progress,
    terminal: false,
    progressAccessibilityLabel: `${levelLabel}, ${progress}% toward level ${level.level + 1}`
  };
};

export const progressionPresentation = (
  summary: ProgressionSummary,
  profile: Profile | undefined
): ProgressionPresentation => ({
  totalXpLabel: `${grouped(summary.totalXp)} XP`,
  level: levelPresentation(summary),
  tierLabel: profile?.cosmetic.tier
});

/**
 * The server reports how many days were active, never which ones, so the pips
 * are an unlabelled count meter and must not carry weekday identity. Missed
 * days are absent, never marked: a quiet week costs nothing already earned
 * (ADR-0005).
 */
export const consistencyPresentation = (
  summary: ProgressionSummary
): ConsistencyPresentation | undefined => {
  const consistency = summary.weeklyConsistency;
  if (!consistency) return undefined;
  const activeDays = Math.min(DAYS_IN_WEEK, Math.max(0, Math.trunc(consistency.activeDays)));
  const activeDaysLabel = `${activeDays} of ${DAYS_IN_WEEK} active days`;
  const cappedMinutesLabel = `${grouped(consistency.cappedActiveMinutes)} counted active minutes`;
  return {
    weekLabel: consistency.current ? 'This week' : `Week of ${consistency.periodStart}`,
    pips: Array.from({ length: DAYS_IN_WEEK }, (_, index) => ({
      index,
      active: index < activeDays
    })),
    activeDaysLabel,
    goalLabel:
      consistency.goalActiveDays === undefined
        ? undefined
        : `Goal ${consistency.goalActiveDays} days`,
    cappedMinutesLabel,
    accessibilityLabel: `${activeDaysLabel} this week, ${cappedMinutesLabel}`,
    reassurance: 'A quieter week never reduces XP you have already earned.'
  };
};

/** Progression is secondary to the weekly goal, so it only speaks when nothing louder is wrong. */
export const progressionStatusMessage = (state: ProgressionCardState): string => {
  if (state === 'configuration') return 'Progression is unavailable until RunSphere is configured.';
  if (state === 'loading') return 'Refreshing progression.';
  if (state === 'offline') return 'Progression is unavailable offline.';
  if (state === 'unavailable') return 'Progression is not available on this server yet.';
  if (state === 'error') return 'Progression is unavailable.';
  return '';
};
