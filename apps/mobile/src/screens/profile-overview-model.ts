import type { AchievementAward, TerritoryClaimSummary } from '@runsphere/contracts';
import { turfAreaLabel } from './home-progression-model';

export interface ProfileStatCell {
  readonly key: string;
  readonly value: string;
  readonly label: string;
}

export const profileStatCells = (
  turf: TerritoryClaimSummary | undefined
): readonly ProfileStatCell[] =>
  turf ? [{ key: 'held', label: 'Turf held', value: turfAreaLabel(turf.totalAreaSqm) }] : [];

export interface AchievementMedallion {
  readonly key: string;
  readonly achievementKey: string;
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
        achievementKey: award.achievementKey,
        label,
        awardedOn,
        accessibilityLabel: awardedOn ? `${label}. Earned on ${awardedOn}.` : `${label}. Earned.`
      };
    });

export const XP_INFO_COPY = 'XP earns profile levels. Everyone follows the same Turf rules.';

export const FAIR_PLAY_PRIVACY = [
  'GPS and pace checks keep Turf fair. Verified runs can be submitted for claims on Map.',
  'Your phone confirms it is you before you run. Your face, fingerprint, and passcode stay on your device.',
  'Your run starts privately. Publishing a Turf claim shares the loop on the map, with privacy protections applied.'
] as const;
