import { describe, expect, it } from 'vitest';
import {
  accountProblem,
  canSubmitAccount,
  dateOfBirthFrom,
  initialOnboardingState,
  onboardingReducer
} from './onboarding.js';

describe('onboarding state machine', () => {
  it('requires a valid password, an adult date of birth, a username and a name to register', () => {
    expect(canSubmitAccount(initialOnboardingState)).toBe(false);

    const account = {
      ...initialOnboardingState,
      step: 'account' as const,
      name: 'Maya',
      email: 'maya@example.com',
      password: 'long-enough-password',
      username: '@Maya_Runs',
      birthDay: '5',
      birthMonth: '3',
      birthYear: '1996'
    };
    expect(canSubmitAccount(account, '2026-11-21')).toBe(true);
    expect(dateOfBirthFrom(account)).toBe('1996-03-05');

    // Under 18 on the day, said plainly rather than as a dead button.
    const minor = { ...account, birthYear: '2010' };
    expect(accountProblem(minor, '2026-11-21')).toMatch(/18 or older/);
    expect(accountProblem({ ...account, username: '9lives' }, '2026-11-21')).toMatch(/Usernames/);
    expect(accountProblem({ ...account, birthDay: '' }, '2026-11-21')).toMatch(/date of birth/);
  });

  it('adds the Who can see you step after sign-up, but not after sign-in', () => {
    const registered = onboardingReducer(
      { ...initialOnboardingState, accountMode: 'register', step: 'account' },
      { type: 'authenticationSucceeded' }
    );
    expect(registered.step).toBe('social');
    expect(onboardingReducer(registered, { type: 'socialDone' }).step).toBe('privacy');
    expect(onboardingReducer({ ...registered, step: 'privacy' }, { type: 'back' }).step).toBe(
      'social'
    );

    const signedIn = onboardingReducer(
      { ...initialOnboardingState, accountMode: 'login', step: 'account' },
      { type: 'authenticationSucceeded' }
    );
    expect(signedIn.step).toBe('privacy');
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

  it('leaves start and finish shown by default (ADR-0015) and handles denial retry/back predictably', () => {
    const denied = onboardingReducer(
      { ...initialOnboardingState, step: 'privacy' },
      { type: 'setLocation', status: 'denied' }
    );
    expect(denied).toMatchObject({
      step: 'location-denied',
      location: 'denied',
      hideStartFinish: false
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
    expect(recovered).toMatchObject({ step: 'privacy', location: 'granted' });
    expect(onboardingReducer(recovered, { type: 'finish' }).step).toBe('complete');
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
      location: 'granted' as const
    };

    expect(onboardingReducer(completed, { type: 'logoutComplete' })).toEqual(
      initialOnboardingState
    );
  });
});
