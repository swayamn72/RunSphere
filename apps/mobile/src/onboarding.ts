export type MovementPreference = 'walk' | 'run';
export type LocationStatus = 'idle' | 'granted' | 'denied';
export type MotionStatus = 'idle' | 'granted' | 'denied' | 'skipped';

export type OnboardingStep = 'welcome' | 'account' | 'privacy' | 'location-denied' | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  movement: MovementPreference;
  name: string;
  email: string;
  isAdult: boolean;
  hideStartFinish: boolean;
  visibility: 'private';
  location: LocationStatus;
  motion: MotionStatus;
}

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  movement: 'walk',
  name: '',
  email: '',
  isAdult: false,
  hideStartFinish: true,
  visibility: 'private',
  location: 'idle',
  motion: 'idle'
};

export type OnboardingAction =
  | { type: 'chooseMovement'; movement: MovementPreference }
  | { type: 'startAccount' }
  | { type: 'updateAccount'; name?: string; email?: string; isAdult?: boolean }
  | { type: 'submitAccount' }
  | { type: 'setHideStartFinish'; value: boolean }
  | { type: 'setLocation'; status: LocationStatus }
  | { type: 'setMotion'; status: MotionStatus }
  | { type: 'retryLocation' }
  | { type: 'continueWithoutLocation' }
  | { type: 'finish' }
  | { type: 'back' };

export const canSubmitAccount = (state: OnboardingState): boolean =>
  state.isAdult && state.name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(state.email.trim());

export const onboardingReducer = (
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState => {
  switch (action.type) {
    case 'chooseMovement':
      return { ...state, movement: action.movement };
    case 'startAccount':
      return { ...state, step: 'account' };
    case 'updateAccount':
      return { ...state, ...action };
    case 'submitAccount':
      return canSubmitAccount(state) ? { ...state, step: 'privacy' } : state;
    case 'setHideStartFinish':
      return { ...state, hideStartFinish: action.value };
    case 'setLocation':
      return action.status === 'denied'
        ? { ...state, location: 'denied', step: 'location-denied' }
        : { ...state, location: 'granted', step: 'privacy' };
    case 'setMotion':
      return { ...state, motion: action.status };
    case 'retryLocation':
      return { ...state, step: 'privacy' };
    case 'continueWithoutLocation':
      return { ...state, step: 'complete' };
    case 'finish':
      return { ...state, step: 'complete' };
    case 'back':
      return state.step === 'account'
        ? { ...state, step: 'welcome' }
        : state.step === 'privacy'
          ? { ...state, step: 'account' }
          : { ...state, step: 'privacy' };
  }
};
