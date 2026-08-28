export type MovementPreference = 'walk' | 'run' | 'hike';
export type LocationStatus = 'idle' | 'granted' | 'denied' | 'blocked';
export type MotionStatus = 'idle' | 'granted' | 'denied' | 'skipped';
export type AccountMode = 'register' | 'login';

export type OnboardingStep = 'welcome' | 'account' | 'privacy' | 'location-denied' | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  accountMode: AccountMode;
  movement: MovementPreference;
  name: string;
  email: string;
  password: string;
  isAdult: boolean;
  hideStartFinish: boolean;
  visibility: 'private';
  location: LocationStatus;
  motion: MotionStatus;
}

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  accountMode: 'register',
  movement: 'walk',
  name: '',
  email: '',
  password: '',
  isAdult: false,
  hideStartFinish: true,
  visibility: 'private',
  location: 'idle',
  motion: 'idle'
};

export type OnboardingAction =
  | { type: 'chooseMovement'; movement: MovementPreference }
  | { type: 'startAccount'; mode: AccountMode }
  | { type: 'updateAccount'; name?: string; email?: string; password?: string; isAdult?: boolean }
  | { type: 'authenticationSucceeded' }
  | { type: 'restoreSession' }
  | { type: 'setHideStartFinish'; value: boolean }
  | { type: 'setLocation'; status: LocationStatus }
  | { type: 'setMotion'; status: MotionStatus }
  | { type: 'retryLocation' }
  | { type: 'continueWithoutLocation' }
  | { type: 'finish' }
  | { type: 'logoutComplete' }
  | { type: 'back' };

const hasValidEmail = (email: string): boolean => /^\S+@\S+\.\S+$/.test(email.trim());
const hasValidPassword = (password: string): boolean => password.length >= 12;

export const canSubmitAccount = (state: OnboardingState): boolean =>
  hasValidEmail(state.email) &&
  hasValidPassword(state.password) &&
  (state.accountMode === 'login' || (state.isAdult && state.name.trim().length > 0));

export const onboardingReducer = (
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState => {
  switch (action.type) {
    case 'chooseMovement':
      return { ...state, movement: action.movement };
    case 'startAccount':
      return { ...state, accountMode: action.mode, step: 'account' };
    case 'updateAccount':
      return {
        ...state,
        ...(action.name !== undefined ? { name: action.name } : {}),
        ...(action.email !== undefined ? { email: action.email } : {}),
        ...(action.password !== undefined ? { password: action.password } : {}),
        ...(action.isAdult !== undefined ? { isAdult: action.isAdult } : {})
      };
    case 'authenticationSucceeded':
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
    case 'setMotion':
      return { ...state, motion: action.status === 'denied' ? 'skipped' : action.status };
    case 'retryLocation':
      return { ...state, location: 'idle', step: 'privacy' };
    case 'continueWithoutLocation':
    case 'finish':
      return { ...state, step: 'complete' };
    case 'logoutComplete':
      return initialOnboardingState;
    case 'back':
      if (state.step === 'account') return { ...state, step: 'welcome' };
      if (state.step === 'privacy') return { ...state, step: 'account' };
      if (state.step === 'location-denied') return { ...state, step: 'privacy' };
      return state;
  }
};
