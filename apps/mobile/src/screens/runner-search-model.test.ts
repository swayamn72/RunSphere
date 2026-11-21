import { describe, expect, it } from 'vitest';
import type { PublicProfile } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import {
  addFailureMessage,
  inviteShareMessage,
  markRequested,
  runnerAction,
  runnerSubtitle,
  searchEmptyMessage,
  searchQuery,
  shouldSearch
} from './runner-search-model';

const profile = (overrides: Partial<PublicProfile> = {}): PublicProfile => ({
  id: '00000000-0000-4000-8000-000000000001',
  username: 'ravi_runs',
  displayName: 'Ravi',
  cosmetic: { avatarKey: 'default' },
  relationship: 'none',
  canSendRequest: true,
  ...overrides
});

describe('runner search (ADR-0014)', () => {
  it('reads a typed @handle the way the server does', () => {
    expect(searchQuery('  @Ravi_Runs ')).toBe('ravi_runs');
    expect(shouldSearch('@r')).toBe(false);
    expect(shouldSearch('ra')).toBe(true);
  });

  it('offers Add only when the runner takes requests from the reader', () => {
    expect(runnerAction(profile())).toEqual({ kind: 'add', label: 'Add' });
    expect(runnerAction(profile({ canSendRequest: false })).label).toBe('Not taking requests');
    expect(runnerAction(profile({ relationship: 'friend' })).label).toBe('Friends');
    expect(runnerAction(profile({ relationship: 'request_sent' })).label).toBe('Requested');
  });

  it('shows the handle and area under the name', () => {
    expect(runnerSubtitle(profile({ homeArea: 'Bandra West' }))).toBe('@ravi_runs · Bandra West');
    expect(runnerSubtitle(profile())).toBe('@ravi_runs');
  });

  it('marks a row requested straight after sending', () => {
    const [row] = markRequested([profile()], profile().id);
    expect(runnerAction(row!).label).toBe('Requested');
  });

  it('speaks plainly when nothing matches or a request fails', () => {
    expect(searchEmptyMessage('@nobody')).toContain('@nobody');
    expect(addFailureMessage(new ApiFailure(429, 'x'))).toMatch(/Wait a minute/);
    expect(
      addFailureMessage(new ApiFailure(500, 'Request to /v1/friends failed (500).'))
    ).not.toMatch(/\/v1\//);
    expect(inviteShareMessage('runsphere://invite/abc')).toContain('runsphere://invite/abc');
  });
});
