import { isAdult, kolkataDate, normalizeUsername, usernameProblem } from '@runsphere/domain';

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

const hasValidEmail = (email: string): boolean => /^\S+@\S+\.\S+$/.test(email.trim());
const hasValidPassword = (password: string): boolean => password.length >= 12;

/** `YYYY-MM-DD` from the three fields, or undefined while incomplete. */
export const dateOfBirthFrom = (state: OnboardingState): string | undefined => {
  const day = state.birthDay.trim();
  const month = state.birthMonth.trim();
  const year = state.birthYear.trim();
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return undefined;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

/**
 * The one thing stopping sign-up, in plain words, or undefined when it can
 * go. Shown under the form so a disabled button is never a mystery.
 */
export const accountProblem = (
  state: OnboardingState,
  today: string = kolkataDate(new Date())
): string | undefined => {
  if (state.accountMode === 'register') {
    if (state.name.trim().length === 0) return 'Add a display name.';
    const username = normalizeUsername(state.username);
    if (username.length === 0) return 'Pick a username.';
    if (usernameProblem(username))
      return 'Usernames are 3–20 letters, numbers or _, starting with a letter.';
    const dob = dateOfBirthFrom(state);
    if (!dob) return 'Add your date of birth.';
    if (!isAdult(dob, today)) return 'You need to be 18 or older to use TURFR.';
  }
  if (!hasValidEmail(state.email)) return 'Add your email.';
  if (!hasValidPassword(state.password)) return 'Passwords need at least 12 characters.';
  if (state.accountMode === 'register' && !state.acceptedLegal)
    return 'Tick the box to agree to the terms.';
  return undefined;
};

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
