/**
 * Social identity rules (ADR-0014): usernames, the adult-only age check and
 * home areas. Pure, so the API, the app and the tests read the same rules.
 */

/** 3–20 characters: lowercase letters, digits and `_`, starting with a letter. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

/**
 * Names that would impersonate the product or staff, or route words. Kept
 * short on purpose: this is not a moderation system, and an offensive name
 * that slips through is handled by a report like any other content.
 */
const RESERVED = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'staff',
  'moderator',
  'mod',
  'official',
  'runsphere',
  'rho',
  'mira',
  'coda',
  'bram',
  'system',
  'root',
  'null',
  'undefined',
  'me',
  'settings',
  'profile',
  'search',
  'invite',
  'api'
]);

/** Fragments that make a name unacceptable wherever they appear. */
const BLOCKED_FRAGMENTS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'rape',
  'chutiya',
  'madarchod',
  'bhenchod',
  'behenchod',
  'randi',
  'gaand',
  'lund'
];

export const normalizeUsername = (raw: string): string =>
  raw.trim().replace(/^@/, '').toLowerCase();

export type UsernameProblem = 'format' | 'reserved' | 'not_allowed';

/** Why a normalized username can't be used, or `undefined` when it can. */
export const usernameProblem = (username: string): UsernameProblem | undefined => {
  if (!USERNAME_PATTERN.test(username)) return 'format';
  if (RESERVED.has(username) || username.startsWith('runsphere')) return 'reserved';
  if (BLOCKED_FRAGMENTS.some((fragment) => username.includes(fragment))) return 'not_allowed';
  return undefined;
};

export const USERNAME_PROBLEM_MESSAGE: Readonly<Record<UsernameProblem, string>> = {
  format: 'Use 3–20 letters, numbers or _, starting with a letter.',
  reserved: 'That name is reserved. Try another.',
  not_allowed: "That name isn't allowed. Try another."
};

/**
 * A starting suggestion from a display name, for accounts created before
 * usernames and for the sign-up field. Uniqueness is the database's job: the
 * caller appends digits until the insert succeeds.
 */
export const usernameSeed = (displayName: string): string => {
  const base = displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 14);
  const seed = base.length >= 3 ? base : `runner${base}`;
  return usernameProblem(seed) === undefined ? seed : 'runner';
};

export const MINIMUM_AGE_YEARS = 18;

/**
 * Whole years between a `YYYY-MM-DD` date of birth and `today` (also
 * `YYYY-MM-DD`, in Asia/Kolkata), or `undefined` for a date that isn't real or
 * is in the future. Compared as calendar dates so a birthday counts from the
 * start of that day in India, whatever the server's timezone.
 */
export const ageOn = (dateOfBirth: string, today: string): number | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match || !now) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return undefined;
  if (dateOfBirth > today) return undefined;
  const [nowYear, nowMonth, nowDay] = [Number(now[1]), Number(now[2]), Number(now[3])];
  const hadBirthday = nowMonth > month || (nowMonth === month && nowDay >= day);
  return nowYear - year - (hadBirthday ? 0 : 1);
};

export const isAdult = (dateOfBirth: string, today: string): boolean => {
  const age = ageOn(dateOfBirth, today);
  return age !== undefined && age >= MINIMUM_AGE_YEARS && age <= 120;
};

/**
 * Home areas a runner may pick (ADR-0014): neighbourhoods, never a point. The
 * launch city first; the list grows by adding names here, and the API refuses
 * anything not on it so a free-text field can't carry an address.
 */
export const HOME_AREAS: readonly string[] = [
  'Andheri East',
  'Andheri West',
  'Bandra East',
  'Bandra West',
  'Borivali',
  'Byculla',
  'Chembur',
  'Colaba',
  'Dadar',
  'Fort',
  'Ghatkopar',
  'Goregaon',
  'Juhu',
  'Kandivali',
  'Khar',
  'Kurla',
  'Lower Parel',
  'Malad',
  'Marine Drive',
  'Matunga',
  'Mulund',
  'Navi Mumbai',
  'Powai',
  'Santacruz',
  'Sion',
  'Thane',
  'Versova',
  'Vile Parle',
  'Wadala',
  'Worli'
];

export const isHomeArea = (value: string): boolean => HOME_AREAS.includes(value);
