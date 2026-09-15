import type {
  AchievementAward,
  ProgressionSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';

/**
 * Presentation for the profile overview: the level band, the summary stats,
 * and the earned-achievement strip.
 *
 * Every figure is copied from a server response, which constrains the design
 * in two places worth naming:
 *
 * - **Nothing here is a lifetime total.** The API reports the current week's
 *   distance and active minutes and no all-time aggregate, so the cells say
 *   "this week" rather than "total". Relabelling them "Total" would be a
 *   claim about data the app has never been sent.
 * - **No ranking.** There is no "top 10% in your city" anywhere in the API,
 *   and a percentile cannot be derived from one account's own figures.
 */

/** Grouped thousands without Intl, so Hermes builds format identically to tests. */
const grouped = (value: number): string =>
  Math.trunc(Math.max(0, value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface ProfileStatCell {
  readonly key: string;
  readonly value: string;
  readonly label: string;
}

/**
 * The stat cells whose sources have loaded. A cell is omitted rather than
 * zeroed, so a still-loading week never reads as a week with no running in it.
 */
export const profileStatCells = (
  goal: WeeklyGoalResponse | undefined,
  progression: ProgressionSummary | undefined
): readonly ProfileStatCell[] => {
  const cells: ProfileStatCell[] = [];
  if (goal)
    cells.push(
      {
        key: 'distance',
        value: `${(goal.distanceMeters.actual / 1000).toFixed(1)} km`,
        label: 'Distance this week'
      },
      {
        key: 'active-minutes',
        value: grouped(goal.activeMinutes.actual),
        label: 'Active minutes this week'
      }
    );
  if (progression) {
    cells.push({ key: 'xp', value: grouped(progression.totalXp), label: 'Cosmetic XP' });
    if (progression.weeklyConsistency)
      cells.push({
        key: 'active-days',
        value: `${Math.max(0, Math.min(7, progression.weeklyConsistency.activeDays))} / 7`,
        label: 'Active days this week'
      });
    cells.push({
      key: 'achievements',
      value: `${progression.achievements.length}`,
      label: progression.achievements.length === 1 ? 'Achievement' : 'Achievements'
    });
  }
  return cells;
};

export interface AchievementMedallion {
  readonly key: string;
  readonly label: string;
  readonly awardedOn: string | undefined;
  readonly accessibilityLabel: string;
}

const KOLKATA_OFFSET_MS = 19_800_000;

/** Award date without `Intl`, on the same day boundary the server scores on. */
const awardedDate = (awardedAt: string): string | undefined => {
  const instant = Date.parse(awardedAt);
  if (!Number.isFinite(instant)) return undefined;
  return new Date(instant + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);
};

/**
 * The award carries a key, not a title — titles live on the published
 * definitions the achievements screen loads. Humanising the key is the honest
 * middle ground: it is the server's own identifier for the award, made
 * readable, rather than a title invented here.
 */
export const humanizeAchievementKey = (key: string): string => {
  const words = key.replaceAll(/[_-]+/g, ' ').trim().replaceAll(/\s+/g, ' ');
  if (!words) return 'Achievement';
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Most recently awarded first, so the strip leads with what just happened. */
export const achievementMedallions = (
  awards: readonly AchievementAward[],
  limit = 3
): readonly AchievementMedallion[] =>
  [...awards]
    .sort((left, right) => right.awardedAt.localeCompare(left.awardedAt))
    .slice(0, Math.max(0, limit))
    .map((award) => {
      const label = humanizeAchievementKey(award.achievementKey);
      const awardedOn = awardedDate(award.awardedAt);
      return {
        key: award.id,
        label,
        awardedOn,
        accessibilityLabel: awardedOn ? `${label}. Earned on ${awardedOn}.` : `${label}. Earned.`
      };
    });
