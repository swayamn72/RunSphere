import { describe, expect, it } from 'vitest';
import { canSubmitAccount, initialOnboardingState, onboardingReducer } from './onboarding.js';

describe('onboarding state machine', () => {
  it('requires a valid password, adult assertion, and account details for registration', () => {
    expect(canSubmitAccount(initialOnboardingState)).toBe(false);

    const account = {
      ...initialOnboardingState,
      step: 'account' as const,
      name: 'Maya',
      email: 'maya@example.com',
      password: 'long-enough-password',
      isAdult: true
    };
    expect(canSubmitAccount(account)).toBe(true);
  });

  it('permits password-based login without registration-only fields', () => {
    expect(
      canSubmitAccount({
        ...initialOnboardingState,
        accountMode: 'login',
        email: 'maya@example.com',
        password: 'long-enough-password'
      })
    ).toBe(true);
  });

  it('keeps the 200 m safety zone on by default and handles denial retry/back predictably', () => {
    const denied = onboardingReducer(
      { ...initialOnboardingState, step: 'privacy' },
      { type: 'setLocation', status: 'denied' }
    );
    expect(denied).toMatchObject({
      step: 'location-denied',
      location: 'denied',
      hideStartFinish: true
    });
    const retry = onboardingReducer(denied, { type: 'retryLocation' });
    expect(retry).toMatchObject({ step: 'privacy', location: 'idle' });
    expect(onboardingReducer(denied, { type: 'back' }).step).toBe('privacy');
  });

  it('updates only explicit account fields and restores a durable session to home', () => {
    const state = onboardingReducer(initialOnboardingState, {
      type: 'updateAccount',
      email: 'maya@example.com'
    });
    expect(state).toMatchObject({ email: 'maya@example.com', step: 'welcome' });
    expect(onboardingReducer(state, { type: 'restoreSession' }).step).toBe('complete');
  });
});
