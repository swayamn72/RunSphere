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

    const blocked = onboardingReducer(retry, { type: 'setLocation', status: 'blocked' });
    expect(blocked).toMatchObject({ step: 'location-denied', location: 'blocked' });
    expect(onboardingReducer(blocked, { type: 'setLocation', status: 'granted' })).toMatchObject({
      step: 'privacy',
      location: 'granted'
    });
  });

  it('keeps recovered location on the privacy step until explicit Continue', () => {
    const recovered = onboardingReducer(
      { ...initialOnboardingState, step: 'location-denied', location: 'denied' },
      { type: 'setLocation', status: 'granted' }
    );
    expect(recovered).toMatchObject({ step: 'privacy', location: 'granted', motion: 'idle' });

    const declinedMotion = onboardingReducer(recovered, { type: 'setMotion', status: 'denied' });
    expect(declinedMotion).toMatchObject({ step: 'privacy', motion: 'skipped' });
    expect(onboardingReducer(declinedMotion, { type: 'finish' }).step).toBe('complete');
  });

  it('updates only explicit account fields and restores a durable session to home', () => {
    const state = onboardingReducer(initialOnboardingState, {
      type: 'updateAccount',
      email: 'maya@example.com'
    });
    expect(state).toMatchObject({ email: 'maya@example.com', step: 'welcome' });
    expect(onboardingReducer(state, { type: 'restoreSession' }).step).toBe('complete');
  });

  it('resets a completed session to the pristine Welcome state after logout cleanup', () => {
    const completed = {
      ...initialOnboardingState,
      step: 'complete' as const,
      accountMode: 'login' as const,
      email: 'maya@example.com',
      password: 'do-not-retain-this-password',
      location: 'granted' as const,
      motion: 'skipped' as const
    };

    expect(onboardingReducer(completed, { type: 'logoutComplete' })).toEqual(
      initialOnboardingState
    );
  });
});
