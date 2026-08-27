import { describe, expect, it } from 'vitest';
import { canSubmitAccount, initialOnboardingState, onboardingReducer } from './onboarding.js';

describe('onboarding state machine', () => {
  it('requires an adult assertion and valid account details before privacy setup', () => {
    const incomplete = onboardingReducer(initialOnboardingState, { type: 'submitAccount' });
    expect(incomplete.step).toBe('welcome');

    const account = onboardingReducer(
      {
        ...initialOnboardingState,
        step: 'account',
        name: 'Maya',
        email: 'maya@example.com',
        isAdult: true
      },
      { type: 'submitAccount' }
    );
    expect(canSubmitAccount(account)).toBe(true);
    expect(account.step).toBe('privacy');
  });

  it('keeps the 200 m safety zone on by default and supports denial retry', () => {
    const denied = onboardingReducer(
      { ...initialOnboardingState, step: 'privacy' },
      { type: 'setLocation', status: 'denied' }
    );
    expect(denied).toMatchObject({ step: 'location-denied', hideStartFinish: true });
    expect(onboardingReducer(denied, { type: 'retryLocation' }).step).toBe('privacy');
  });
});
