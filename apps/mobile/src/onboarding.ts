import {
  ageOn,
  kolkataDate,
  MINIMUM_AGE_YEARS,
  normalizeUsername,
  usernameProblem
} from '@runsphere/domain';

export type LocationStatus = 'idle' | 'granted' | 'denied' | 'blocked';
export type AccountMode = 'register' | 'login';

/**
 * `social` follows sign-up only (ADR-0014): profile visibility, home area and
 * the privacy-zone prompt. Signing in goes straight to `privacy` (location).
 */
export type OnboardingStep =
  'welcome' | 'account' | 'social' | 'privacy' | 'location-denied' | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  accountMode: AccountMode;
  name: string;
  email: string;
  password: string;
  username: string;
  /** Date of birth as typed, day / month / year (ADR-0014: the 18+ check). */
  birthDay: string;
  birthMonth: string;
  birthYear: string;
  /**
   * The sign-up checkbox: the runner ticked that they agree to the terms and
   * community guidelines and have read the privacy notice. Create account
   * stays off until it's ticked, so agreeing is a clear action (DPDP s.6).
   */
  acceptedLegal: boolean;
  hideStartFinish: boolean;
  visibility: 'private';
  location: LocationStatus;
}

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  accountMode: 'register',
  name: '',
  email: '',
  password: '',
  username: '',
  birthDay: '',
  birthMonth: '',
  birthYear: '',
  acceptedLegal: false,
  hideStartFinish: false,
  visibility: 'private',
  location: 'idle'
};

export type OnboardingAction =
  | { type: 'startAccount'; mode: AccountMode }
  | {
      type: 'updateAccount';
      name?: string;
      email?: string;
      password?: string;
      username?: string;
      birthDay?: string;
      birthMonth?: string;
      birthYear?: string;
    }
  | { type: 'setAcceptedLegal'; value: boolean }
  | { type: 'socialDone' }
  | { type: 'authenticationSucceeded' }
  | { type: 'restoreSession' }
  | { type: 'setHideStartFinish'; value: boolean }
  | { type: 'setLocation'; status: LocationStatus }
  | { type: 'retryLocation' }
  | { type: 'continueWithoutLocation' }
  | { type: 'finish' }
  | { type: 'logoutComplete' }
  | { type: 'back' };

const hasValidEmail = (email: string): boolean =>
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    email
  );
const SIGN_UP_PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
export const signUpPasswordHint = `Use at least ${SIGN_UP_PASSWORD_MIN} characters.`;

/** `YYYY-MM-DD` from the three fields, or undefined while incomplete. */
export const dateOfBirthFrom = (state: OnboardingState): string | undefined => {
  const day = state.birthDay.trim();
  const month = state.birthMonth.trim();
  const year = state.birthYear.trim();
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return undefined;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export const accountFieldProblems = (
  state: OnboardingState,
  today: string = kolkataDate(new Date())
) => {
  const problems: Partial<
    Record<'name' | 'username' | 'birthDate' | 'email' | 'password' | 'terms', string>
  > = {};
  if (state.accountMode === 'register') {
    const nameLength = [...state.name.trim()].length;
    if (!nameLength) problems.name = 'Add a display name.';
    else if (nameLength > 40) problems.name = 'Use 40 characters or fewer for your display name.';
    const username = normalizeUsername(state.username);
    if (!username) problems.username = 'Pick a username.';
    else if (usernameProblem(username))
      problems.username = 'Usernames are 3–20 letters, numbers or _, starting with a letter.';
    const dob = dateOfBirthFrom(state);
    const age = dob ? ageOn(dob, today) : undefined;
    if (age === undefined || age > 120) problems.birthDate = 'Enter a valid date of birth.';
    else if (age < MINIMUM_AGE_YEARS)
      problems.birthDate = 'You need to be 18 or older to use TURFR.';
  }
  const email = state.email.trim();
  if (!email) problems.email = 'Add your email address.';
  else if (email.length > 320) problems.email = 'Use an email address of 320 characters or fewer.';
  else if (!hasValidEmail(email)) problems.email = 'Enter an email address like you@example.com.';
  const passwordLength = [...state.password].length;
  if (!passwordLength) problems.password = 'Enter your password.';
  else if (state.accountMode === 'register' && passwordLength < SIGN_UP_PASSWORD_MIN)
    problems.password = `Use at least ${SIGN_UP_PASSWORD_MIN} characters for your password.`;
  else if (passwordLength > PASSWORD_MAX) problems.password = 'Use a shorter password.';
  if (state.accountMode === 'register' && !state.acceptedLegal)
    problems.terms = 'Tick the box to agree to the terms.';
  return problems;
};

export const accountProblem = (state: OnboardingState, today?: string): string | undefined =>
  Object.values(accountFieldProblems(state, today))[0];

export const canSubmitAccount = (state: OnboardingState, today?: string): boolean =>
  accountProblem(state, today) === undefined;

export const onboardingReducer = (
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState => {
  switch (action.type) {
    case 'startAccount':
      return { ...state, accountMode: action.mode, step: 'account' };
    case 'updateAccount':
      return {
        ...state,
        ...(action.name !== undefined ? { name: action.name } : {}),
        ...(action.email !== undefined ? { email: action.email } : {}),
        ...(action.password !== undefined ? { password: action.password } : {}),
        ...(action.username !== undefined ? { username: action.username } : {}),
        ...(action.birthDay !== undefined ? { birthDay: action.birthDay } : {}),
        ...(action.birthMonth !== undefined ? { birthMonth: action.birthMonth } : {}),
        ...(action.birthYear !== undefined ? { birthYear: action.birthYear } : {})
      };
    case 'authenticationSucceeded':
      return { ...state, step: state.accountMode === 'register' ? 'social' : 'privacy' };
    case 'setAcceptedLegal':
      return { ...state, acceptedLegal: action.value };
    case 'socialDone':
      return { ...state, step: 'privacy' };
    case 'restoreSession':
      return { ...state, step: 'complete' };
    case 'setHideStartFinish':
      return { ...state, hideStartFinish: action.value };
    case 'setLocation':
      if (action.status === 'denied' || action.status === 'blocked')
        return { ...state, location: action.status, step: 'location-denied' };
      if (action.status === 'granted') return { ...state, location: 'granted', step: 'privacy' };
      return { ...state, location: 'idle' };
    case 'retryLocation':
      return { ...state, location: 'idle', step: 'privacy' };
    case 'continueWithoutLocation':
    case 'finish':
      return { ...state, step: 'complete' };
    case 'logoutComplete':
      return initialOnboardingState;
    case 'back':
      if (state.step === 'account') return { ...state, step: 'welcome' };
      // The account exists once past `account`, so back never returns there
      // after sign-up; it stops at the social step instead.
      if (state.step === 'privacy')
        return { ...state, step: state.accountMode === 'register' ? 'social' : 'account' };
      if (state.step === 'location-denied') return { ...state, step: 'privacy' };
      return state;
  }
};
