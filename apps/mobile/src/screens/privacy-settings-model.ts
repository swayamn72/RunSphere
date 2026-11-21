import type { PrivacySettings, PrivacySettingsUpdate } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';

/**
 * The Privacy & visibility screen (ADR-0014, SI.5). Every label and line of
 * help lives here so the copy is tested and the screen stays layout only.
 */
export type Audience = PrivacySettings['profileVisibility'];
export type RequestsFrom = PrivacySettings['friendRequestsFrom'];

export const AUDIENCE_OPTIONS: readonly { value: Audience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'only_me', label: 'Only me' }
];

export const REQUESTS_FROM_OPTIONS: readonly { value: RequestsFrom; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends_of_friends', label: 'Friends of friends' },
  { value: 'nobody', label: 'Nobody' }
];

export type ToggleKey = Exclude<
  keyof PrivacySettingsUpdate,
  'profileVisibility' | 'runsVisibility' | 'friendRequestsFrom'
>;

export interface ToggleCopy {
  readonly key: ToggleKey;
  readonly label: string;
  readonly help: string;
}

export const TOGGLES: Readonly<
  Record<'discovery' | 'runs' | 'turf' | 'boards', readonly ToggleCopy[]>
> = {
  discovery: [
    {
      key: 'searchable',
      label: 'Show me in search',
      help: 'Off: people can still add you with your invite link.'
    }
  ],
  runs: [
    {
      key: 'showRouteMaps',
      label: 'Show route maps',
      help: 'Maps are always trimmed around your privacy zones.'
    },
    {
      key: 'showStartTimes',
      label: 'Show start times',
      help: 'Off: runs say "Morning run" instead of the time, so your routine stays yours.'
    },
    {
      key: 'trimStartFinish',
      label: 'Hide start and finish',
      help: 'Others see your routes without the first and last 200 m, even away from your privacy zones.'
    }
  ],
  turf: [
    {
      key: 'nameOnGround',
      label: 'Show my name on my ground',
      help: 'Off: strangers see "Runner". Friends still see your name.'
    },
    {
      key: 'drawGround',
      label: 'Show my ground on the map',
      help: 'Off: you keep your ground and your score, but others don’t see it.'
    },
    {
      key: 'ghostRaces',
      label: 'Allow Ghost Races on my loops',
      help: 'Others can race a trimmed copy of your loop. It never shows where you started.'
    }
  ],
  boards: [
    {
      key: 'friendBoard',
      label: 'Friend board',
      help: 'Off: you leave your friends’ weekly board and don’t see it.'
    }
  ]
};

export const PROFILE_HELP: Readonly<Record<Audience, string>> = {
  everyone: 'Anyone can open your profile: your name, @username, avatar and area.',
  friends: 'Only friends can open your profile.',
  only_me: 'Nobody can open your profile. You still show by username on boards you join.'
};

export const RUNS_HELP =
  'Applies when friends can see each other’s runs. Exact start and finish points are never shown.';

export const NEVER_SHARED =
  'Never shared, whatever you choose: your live location, exact start and finish points, raw GPS, date of birth and email.';

/** Apply a change locally before the server confirms, so switches feel instant. */
export const applyChange = (
  settings: PrivacySettings,
  change: PrivacySettingsUpdate
): PrivacySettings => ({ ...settings, ...change });

export const saveFailureMessage = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 429
    ? 'Lots of changes just now. Wait a minute, then try again.'
    : failureMessage(error, "Couldn't save that. Your previous setting is kept.");

/** Username field help while typing, before asking the server. */
export const usernameHint = (typed: string): string | undefined => {
  const name = typed.trim().replace(/^@/, '').toLowerCase();
  if (name.length === 0) return undefined;
  if (!/^[a-z]/.test(name)) return 'Start with a letter.';
  if (!/^[a-z0-9_]*$/.test(name)) return 'Use letters, numbers and _ only.';
  if (name.length < 3) return 'At least 3 characters.';
  if (name.length > 20) return '20 characters at most.';
  return undefined;
};
