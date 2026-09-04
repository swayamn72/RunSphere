import type { AchievementStatus } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';

/**
 * Achievements (milestone 2.9). Cosmetic only, and entirely server-awarded
 * (ADR-0005): this module reads the published list and its earned state, and
 * never decides that something was earned, projects progress toward one, or
 * ranks the account against anyone.
 */

export type AchievementsRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export const achievementsErrorState = (error: unknown): AchievementsRemoteState => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const achievementsState = (
  achievements: readonly AchievementStatus[]
): AchievementsRemoteState => (achievements.length ? 'ready' : 'empty');

export interface AchievementRow {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly earned: boolean;
  /** Awarded date in the Asia/Kolkata calendar, or undefined while unearned. */
  readonly earnedOn: string | undefined;
  readonly rewardLabel: string;
  readonly accessibilityLabel: string;
}

const KOLKATA_OFFSET_MS = 19_800_000;

/** Award date without `Intl`, on the same day boundary the server scores on. */
export const awardedDate = (awardedAt: string | undefined): string | undefined => {
  if (!awardedAt) return undefined;
  const instant = Date.parse(awardedAt);
  if (!Number.isFinite(instant)) return undefined;
  return new Date(instant + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);
};

/**
 * Earned first, most recent at the top, then the rest alphabetically. An
 * unearned achievement is still listed: it says what is possible, which is the
 * only forward-looking claim this screen is allowed to make.
 */
export const achievementRows = (
  achievements: readonly AchievementStatus[]
): readonly AchievementRow[] =>
  [...achievements]
    .sort((left, right) => {
      if (left.earned !== right.earned) return left.earned ? -1 : 1;
      if (left.earned && right.earned)
        return (right.awardedAt ?? '').localeCompare(left.awardedAt ?? '');
      return left.title.localeCompare(right.title);
    })
    .map((achievement) => {
      const earnedOn = achievement.earned ? awardedDate(achievement.awardedAt) : undefined;
      const rewardLabel =
        achievement.rewardXp > 0 ? `${achievement.rewardXp} cosmetic XP` : 'No XP';
      return {
        key: achievement.key,
        title: achievement.title,
        description: achievement.description,
        earned: achievement.earned,
        earnedOn,
        rewardLabel,
        accessibilityLabel: `${achievement.title}. ${achievement.description} ${
          achievement.earned ? (earnedOn ? `Earned on ${earnedOn}.` : 'Earned.') : 'Not earned yet.'
        } ${rewardLabel}.`
      };
    });

export const achievementsSummary = (achievements: readonly AchievementStatus[]): string => {
  const earned = achievements.filter((achievement) => achievement.earned).length;
  return `${earned} of ${achievements.length} earned`;
};

/**
 * `POST /v1/achievements/sync` is idempotent and the server awards; a repeat
 * call adds nothing. The count it returns is the only claim worth reporting.
 */
export const syncNotice = (newlyAwarded: number): string => {
  if (newlyAwarded === 0) return 'Nothing new to award yet.';
  if (newlyAwarded === 1) return 'One new achievement.';
  return `${newlyAwarded} new achievements.`;
};

export const syncFailureNotice = (error: unknown): string =>
  error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls')
    ? 'Checking for achievements needs a connection. Nothing changed.'
    : 'Achievements could not be checked. Nothing changed.';

export const achievementsStatusMessage = (
  state: AchievementsRemoteState,
  notice: string,
  achievements: readonly AchievementStatus[]
): string => {
  if (notice) return notice;
  if (state === 'configuration')
    return 'Achievements are unavailable until RunSphere is configured.';
  if (state === 'loading') return 'Loading achievements.';
  if (state === 'offline') return 'Achievements are unavailable offline.';
  if (state === 'error') return 'Achievements are unavailable.';
  if (state === 'ready') return achievementsSummary(achievements);
  return '';
};
