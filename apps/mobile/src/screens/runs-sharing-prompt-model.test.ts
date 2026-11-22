import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../api-client.js';
import {
  RUNS_PROMPT_LINES,
  agreeToRunsSharing,
  initialRunsAudience,
  needsRunsPrompt
} from './runs-sharing-prompt-model.js';

describe('who sees your runs prompt (M9 9.27)', () => {
  it('shows only when the runner agreed to older legal text, and never blocks when unknown', async () => {
    const status = (needsAcceptance: boolean) => ({
      currentVersion: 'b',
      acceptedVersion: 'a',
      needsAcceptance
    });
    expect(await needsRunsPrompt({ getLegalConsent: async () => status(true) })).toBe(true);
    expect(await needsRunsPrompt({ getLegalConsent: async () => status(false) })).toBe(false);
    expect(
      await needsRunsPrompt({
        getLegalConsent: async () => {
          throw new Error('offline');
        }
      })
    ).toBe(false);
  });

  it('starts on the runner’s own setting, or Friends', () => {
    expect(initialRunsAudience({ runsVisibility: 'only_me' })).toBe('only_me');
    expect(initialRunsAudience(undefined)).toBe('friends');
  });

  it('keeps the setting when unchanged, saving only the agreement', async () => {
    const api = { savePrivacySettings: vi.fn(), acceptLegalPolicy: vi.fn() };
    expect(await agreeToRunsSharing(api as never, 'v2', 'friends', 'friends')).toBeUndefined();
    expect(api.savePrivacySettings).not.toHaveBeenCalled();
    expect(api.acceptLegalPolicy).toHaveBeenCalledWith('v2');
  });

  it('saves a new choice before agreeing', async () => {
    const calls: string[] = [];
    const api = {
      savePrivacySettings: vi.fn(async () => calls.push('settings')),
      acceptLegalPolicy: vi.fn(async () => calls.push('consent'))
    };
    await agreeToRunsSharing(api as never, 'v2', 'only_me', 'friends');
    expect(api.savePrivacySettings).toHaveBeenCalledWith({ runsVisibility: 'only_me' });
    expect(calls).toEqual(['settings', 'consent']);
  });

  it('explains a failure in runner words, and a notice that changed again', async () => {
    const offline = {
      savePrivacySettings: vi.fn(),
      acceptLegalPolicy: vi.fn().mockRejectedValue(new Error('network'))
    };
    expect(await agreeToRunsSharing(offline as never, 'v2', 'friends', 'friends')).toMatch(
      /try again/
    );
    const stale = {
      savePrivacySettings: vi.fn(),
      acceptLegalPolicy: vi.fn().mockRejectedValue(new ApiFailure(409, 'conflict'))
    };
    expect(await agreeToRunsSharing(stale as never, 'v2', 'friends', 'friends')).toMatch(
      /changed again/
    );
  });

  it('says plainly that routes include start and finish unless trimmed', () => {
    expect(RUNS_PROMPT_LINES.join(' ')).toMatch(/route/);
    expect(RUNS_PROMPT_LINES.join(' ')).toMatch(/first and last 200 m/);
  });
});
