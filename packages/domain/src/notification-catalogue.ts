import type { NotificationKind } from '@runsphere/contracts';
import { seasonEndedMessage, weeklyRankMessage } from './territory-claim-season.js';

/**
 * The push notification catalogue (`screens.md`, "Push Notification
 * Catalogue"): all twelve types, their copy, and where a tap goes.
 *
 * **Why this is one file and not twelve inline `INSERT`s.** Before this,
 * every producer wrote its own title, body, and deep link at the call site.
 * That put the four rules `screens.md` states for *all* notifications -
 *
 *   * no raw location, route, or activity detail in any message body;
 *   * sender identity is a display name, never an email or phone number;
 *   * blocked users never appear;
 *   * every type is switchable
 *
 * - in the hands of whoever happened to be writing the next producer. Three of
 * the four are now structural here:
 *
 *   * **No location can leak, because no parameter carries one.** Every
 *     `render` below takes a named record with no coordinate, no bounding box,
 *     and no geometry in it. `areaName` is the published place tag a claim
 *     already shows anybody who can see it (`038_territory_geo_tags.sql`), not
 *     a position.
 *   * **No contact detail can leak**, because names pass through `safeName`,
 *     which refuses anything shaped like an email address or a phone number.
 *   * **Every type maps to a category**, so `pushDeliveryDecision` has a
 *     toggle to read for all twelve.
 *
 * The fourth - blocks - cannot live here: it needs a query. It belongs to each
 * producer, and `notification-delivery.ts` is not where a `blocks` read can
 * happen either. Producers state it explicitly.
 *
 * **Categories, not per-type toggles.** `screens.md` says "per-type on/off
 * preferences". What ships is the seven-category model that `011`, the
 * contract, the API, and the settings screen were all built around, with
 * `progress` added here so quests and streaks are switchable at all. Every one
 * of the twelve is reachable by a switch, which is what the line is for;
 * twelve individual switches is a settings-screen change, not a capability
 * one, and is not done.
 */

export type NotificationType =
  | 'CARVE_SUCCESS'
  | 'CARVE_DEFENDED'
  | 'GHOST_INCOMING'
  | 'WEEKLY_RANK'
  | 'SEASON_ENDING_3D'
  | 'SEASON_ENDED'
  | 'QUEST_AVAILABLE'
  | 'QUEST_COMPLETE'
  | 'CHALLENGE_RECEIVED'
  | 'CHALLENGE_WON'
  | 'CHALLENGE_LOST'
  | 'STREAK';

/** Column limits from `011_gamification_foundations.sql`. */
export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 500;
/** `ProfileSchema.displayName` is 1-40. */
export const NOTIFICATION_NAME_MAX = 40;

/**
 * What a runner is called when their display name is missing or is not a
 * display name. Matches the fallback `territory-claim-routes.ts` already uses
 * on the claim map, so the same person is not named two ways.
 */
export const NOTIFICATION_NAME_FALLBACK = 'RunSphere member';

const EMAIL_SHAPED = /@/;
/** Seven or more digits and separators: a phone number, however it is written. */
const PHONE_SHAPED = /\d[\d\s()+.-]{5,}\d/;

/**
 * A name, or nothing that could be one.
 *
 * `screens.md`: "Sender identity: display name only - never email or phone".
 * A display name is validated 1-40 characters elsewhere, so nothing should
 * arrive here needing this. It refuses rather than trusts anyway, because the
 * failure mode is a phone number in a push notification on a lock screen, and
 * because the check costs nothing.
 *
 * It substitutes rather than throwing: a carve notice is written in the same
 * transaction as the carve, and refusing to name somebody must not be what
 * rolls back a claim.
 */
export const safeName = (name: string | undefined): string => {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return NOTIFICATION_NAME_FALLBACK;
  if (EMAIL_SHAPED.test(trimmed) || PHONE_SHAPED.test(trimmed)) return NOTIFICATION_NAME_FALLBACK;
  return trimmed.length > NOTIFICATION_NAME_MAX
    ? `${trimmed.slice(0, NOTIFICATION_NAME_MAX - 1)}…`
    : trimmed;
};

/** `31,400 m²`, in the grouping the rest of the app uses (ADR-0006, en-IN). */
export const formatAreaSqm = (areaSqm: number): string =>
  `${Math.round(Math.max(0, areaSqm)).toLocaleString('en-IN')} m²`;

/** `" in Bandra"`, or nothing at all when the area has no geocode yet. */
const inArea = (areaName: string | undefined): string => (areaName ? ` in ${areaName}` : '');

export interface NotificationCopy {
  readonly type: NotificationType;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string;
}

export interface CarveNoticeParams {
  /** The claim that was carved or defended - what a tap opens. */
  readonly claimId: string;
  /** The challenger's display name. */
  readonly runnerName: string | undefined;
  /** Published place tag, absent when the claim has no geocode. */
  readonly areaName?: string;
  readonly takenSqm: number;
  /** What the holder is left with. Zero means the whole claim went. */
  readonly heldSqm: number;
}

export interface DefenceNoticeParams {
  readonly claimId: string;
  readonly runnerName: string | undefined;
  readonly areaName?: string;
}

export interface GhostNoticeParams {
  readonly claimId: string;
  readonly runnerName: string | undefined;
}

export interface WeeklyRankParams {
  readonly weekStart: string;
  readonly rank: number;
  readonly totalAreaSqm: number;
  readonly cityTag?: string;
}

export interface SeasonEndingParams {
  readonly seasonMonth: string;
  readonly rank: number;
  readonly totalAreaSqm: number;
  /**
   * How long is actually left.
   *
   * `screens.md` writes "Season ends in 3 days" literally. The job that sends
   * this is state-driven, not clock-driven (`territory-season-reset-job.ts`
   * explains why), so a worker that was down for a day sends it with two days
   * left. Saying "3 days" then would be wrong about the one fact the notice
   * exists to convey.
   */
  readonly daysRemaining: number;
}

export interface SeasonEndedParams {
  readonly seasonMonth: string;
  readonly rank: number;
  readonly peakAreaSqm: number;
  readonly cityTag?: string;
}

export interface QuestAvailableParams {
  readonly questId: string;
  readonly questName: string;
  readonly xp: number;
}

export interface QuestCompleteParams {
  readonly questName: string;
  readonly xp: number;
}

export interface ChallengeReceivedParams {
  readonly challengeId: string;
  readonly runnerName: string | undefined;
  readonly days: number;
  /** "Active minutes", "Active days", "Quests" - what the battle is scored on. */
  readonly modeLabel: string;
}

export interface ChallengeResultParams {
  readonly challengeId: string;
  readonly runnerName: string | undefined;
  readonly yourScore: number;
  readonly theirScore: number;
  /**
   * `min`, `days`, or `quests`.
   *
   * `screens.md` writes "[X] min vs [Y] min" for both results, but
   * `ChallengeModeSchema` has three modes and only one of them is measured in
   * minutes. "5 min vs 4 min" for a five-active-days challenge is simply
   * false.
   */
  readonly unit: string;
}

export interface StreakParams {
  readonly runs: number;
}

const trim = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const copy = (
  type: NotificationType,
  kind: NotificationKind,
  title: string,
  body: string,
  deepLink: string
): NotificationCopy => ({
  type,
  kind,
  // Trimmed rather than left to fail a CHECK constraint: a truncated notice is
  // recoverable, a rolled-back carve is not. Nothing in the catalogue is near
  // the limits, so this is a backstop for an unexpectedly long name or place.
  title: trim(title, NOTIFICATION_TITLE_MAX),
  body: trim(body, NOTIFICATION_BODY_MAX),
  deepLink
});

/**
 * Turf, highlighting one claim. Every territory-claim notice points here, so
 * the mobile deep-link router has one prefix to recognise.
 */
export const claimDeepLink = (claimId: string): string => `runsphere://turf/claim/${claimId}`;

/**
 * Somebody carved your ground.
 *
 * `screens.md` copy assumes a partial carve ("You still hold [Ym²]"). A
 * wipe-out is a real outcome of the same event (`territory-claim.ts`), and
 * telling somebody they still hold 0 m² would be worse than saying what
 * happened, so it gets its own final sentence.
 */
export const carveSuccess = (params: CarveNoticeParams): NotificationCopy =>
  copy(
    'CARVE_SUCCESS',
    'territory_claim',
    'Your ground was carved',
    `${safeName(params.runnerName)} ran through your ground${inArea(params.areaName)}. ` +
      (params.heldSqm > 0
        ? `They took ${formatAreaSqm(params.takenSqm)}. You still hold ${formatAreaSqm(params.heldSqm)}.`
        : `They took ${formatAreaSqm(params.takenSqm)} — all of it.`),
    claimDeepLink(params.claimId)
  );

/** Somebody tried and was not fast enough. */
export const carveDefended = (params: DefenceNoticeParams): NotificationCopy =>
  copy(
    'CARVE_DEFENDED',
    'territory_claim',
    'Your claim held',
    `${safeName(params.runnerName)} tried to take your ground${inArea(params.areaName)}. ` +
      "They weren't fast enough. Your claim stands.",
    claimDeepLink(params.claimId)
  );

export const ghostIncoming = (params: GhostNoticeParams): NotificationCopy =>
  copy(
    'GHOST_INCOMING',
    'territory_claim',
    'Someone is racing your ghost',
    `${safeName(params.runnerName)} is racing your ghost right now.`,
    claimDeepLink(params.claimId)
  );

/** Body delegated to `territory-claim-season.ts`, which already owns the wording. */
export const weeklyRank = (params: WeeklyRankParams): NotificationCopy =>
  copy(
    'WEEKLY_RANK',
    'territory_season',
    'Your week in Turf',
    weeklyRankMessage({
      rank: params.rank,
      totalAreaSqm: params.totalAreaSqm,
      ...(params.cityTag ? { cityTag: params.cityTag } : {})
    }),
    `runsphere://turf/leaderboard/week/${params.weekStart}`
  );

const endsIn = (days: number): string =>
  days <= 1 ? 'Season ends tomorrow' : `Season ends in ${days} days`;

export const seasonEnding = (params: SeasonEndingParams): NotificationCopy =>
  copy(
    'SEASON_ENDING_3D',
    'territory_season',
    endsIn(params.daysRemaining),
    `${endsIn(params.daysRemaining)}. You hold rank #${params.rank} with ${formatAreaSqm(params.totalAreaSqm)}. Keep running.`,
    `runsphere://turf/season/${params.seasonMonth}`
  );

export const seasonEnded = (params: SeasonEndedParams): NotificationCopy =>
  copy(
    'SEASON_ENDED',
    'territory_season',
    `${params.seasonMonth} season ended`,
    seasonEndedMessage({
      seasonMonth: params.seasonMonth,
      rank: params.rank,
      peakAreaSqm: params.peakAreaSqm,
      ...(params.cityTag ? { cityTag: params.cityTag } : {})
    }),
    `runsphere://turf/season/${params.seasonMonth}`
  );

export const questAvailable = (params: QuestAvailableParams): NotificationCopy =>
  copy(
    'QUEST_AVAILABLE',
    'quest',
    'A new quest near you',
    `New quest near you: ${params.questName} · ${params.xp} XP`,
    `runsphere://explore/quest/${params.questId}`
  );

export const questComplete = (params: QuestCompleteParams): NotificationCopy =>
  copy(
    'QUEST_COMPLETE',
    'quest',
    'Quest complete',
    `${params.questName} — done. +${params.xp} XP.`,
    'runsphere://home/xp'
  );

export const challengeReceived = (params: ChallengeReceivedParams): NotificationCopy =>
  copy(
    'CHALLENGE_RECEIVED',
    'challenge_invite',
    'You have been challenged',
    `${safeName(params.runnerName)} challenged you. ${params.days}-day battle. ${params.modeLabel}. Accept?`,
    `runsphere://challenges/${params.challengeId}`
  );

const versus = (params: ChallengeResultParams): string =>
  `${params.yourScore} ${params.unit} vs ${params.theirScore} ${params.unit}`;

export const challengeWon = (params: ChallengeResultParams): NotificationCopy =>
  copy(
    'CHALLENGE_WON',
    'challenge_finished',
    'You won',
    `You beat ${safeName(params.runnerName)}. ${versus(params)}.`,
    `runsphere://challenges/${params.challengeId}`
  );

export const challengeLost = (params: ChallengeResultParams): NotificationCopy =>
  copy(
    'CHALLENGE_LOST',
    'challenge_finished',
    'Challenge over',
    `${safeName(params.runnerName)} edged you. ${versus(params)}. Rematch?`,
    `runsphere://challenges/${params.challengeId}`
  );

/**
 * A draw, which `screens.md` has no copy for and `challengeWinner` can
 * genuinely return: two people with the same active minutes is not rare over a
 * seven-day window. Neither "you beat them" nor "they edged you" is true, so
 * it says what happened. Not one of the twelve — it is the same
 * `challenge_finished` kind and the same toggle.
 */
export const challengeDrawn = (params: ChallengeResultParams): NotificationCopy => ({
  type: 'CHALLENGE_WON',
  kind: 'challenge_finished',
  title: 'Dead heat',
  body: `You and ${safeName(params.runnerName)} finished level. ${versus(params)}. Rematch?`,
  deepLink: `runsphere://challenges/${params.challengeId}`
});

/** What a challenge is scored on, in words a notice can use. */
export const CHALLENGE_MODE_LABEL: Readonly<Record<string, string>> = {
  active_minutes: 'Active minutes',
  active_days: 'Active days',
  quest_completion: 'Quests'
};

/** The unit those scores are counted in. */
export const CHALLENGE_SCORE_UNIT: Readonly<Record<string, string>> = {
  active_minutes: 'min',
  active_days: 'days',
  quest_completion: 'quests'
};

export const streakReached = (params: StreakParams): NotificationCopy =>
  copy(
    'STREAK',
    'streak',
    'Still going',
    `${params.runs} runs in a row. Rho is watching.`,
    'runsphere://home'
  );

/**
 * Which kind every type writes, as data, so a test can walk the whole
 * catalogue and a reader can see the twelve at once without reading twelve
 * functions.
 */
export const NOTIFICATION_KIND_BY_TYPE: Readonly<Record<NotificationType, NotificationKind>> = {
  CARVE_SUCCESS: 'territory_claim',
  CARVE_DEFENDED: 'territory_claim',
  GHOST_INCOMING: 'territory_claim',
  WEEKLY_RANK: 'territory_season',
  SEASON_ENDING_3D: 'territory_season',
  SEASON_ENDED: 'territory_season',
  QUEST_AVAILABLE: 'quest',
  QUEST_COMPLETE: 'quest',
  CHALLENGE_RECEIVED: 'challenge_invite',
  CHALLENGE_WON: 'challenge_finished',
  CHALLENGE_LOST: 'challenge_finished',
  STREAK: 'streak'
};

/**
 * Types nothing produces yet, and what each is waiting on. Kept as data rather
 * than prose so the settings screen can be honest about a toggle that governs
 * nothing, and so this list has to be *edited* when a producer lands rather
 * than quietly going stale.
 */
export const NOTIFICATION_TYPES_WITHOUT_PRODUCERS: Readonly<
  Partial<Record<NotificationType, string>>
> = {
  GHOST_INCOMING: 'Ghost Race is not built. Nothing starts a ghost race to announce.',
  QUEST_AVAILABLE:
    'Quests are a published catalogue filtered by location on read (`008`); no quest is ever assigned to an account, so there is no moment to announce.',
  QUEST_COMPLETE:
    'No quest completion is recorded anywhere. `quest_completion` exists as an XP source with no writer.',
  STREAK:
    'Nothing counts consecutive runs. Progression counts active days inside a week, which is a different measurement.'
};
