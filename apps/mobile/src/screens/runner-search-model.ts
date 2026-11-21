import type { PublicProfile } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';

/**
 * Finding runners by @username (ADR-0014). The server already filtered out
 * anyone the reader may not see, so this only decides what each result offers.
 */
export const MIN_QUERY_LENGTH = 2;

/** What the user typed, as the server reads it: no leading @, lowercase. */
export const searchQuery = (typed: string): string => typed.trim().replace(/^@/, '').toLowerCase();

export const shouldSearch = (typed: string): boolean =>
  searchQuery(typed).length >= MIN_QUERY_LENGTH;

export type RunnerAction =
  | { readonly kind: 'add'; readonly label: 'Add' }
  | { readonly kind: 'status'; readonly label: string };

export const runnerAction = (profile: PublicProfile): RunnerAction => {
  if (profile.relationship === 'friend') return { kind: 'status', label: 'Friends' };
  if (profile.relationship === 'request_sent') return { kind: 'status', label: 'Requested' };
  if (profile.relationship === 'request_received')
    return { kind: 'status', label: 'Wants to be friends' };
  if (profile.relationship === 'self') return { kind: 'status', label: "That's you" };
  if (profile.canSendRequest) return { kind: 'add', label: 'Add' };
  return { kind: 'status', label: 'Not taking requests' };
};

/** One result line: name, then @username and area. */
export const runnerSubtitle = (profile: PublicProfile): string =>
  [`@${profile.username}`, profile.homeArea].filter(Boolean).join(' · ');

/** After a request goes out, the row reads "Requested" without a refetch. */
export const markRequested = (profiles: readonly PublicProfile[], id: string): PublicProfile[] =>
  profiles.map((profile) =>
    profile.id === id
      ? { ...profile, relationship: 'request_sent', canSendRequest: false }
      : profile
  );

export const searchEmptyMessage = (typed: string): string =>
  `No runners match @${searchQuery(typed)}. Check the spelling, or send them an invite link.`;

export const addFailureMessage = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 429
    ? 'Lots of requests just now. Wait a minute, then try again.'
    : failureMessage(error, "Couldn't send that request. Try again.");

export const inviteShareMessage = (link: string): string =>
  `Run with me on RunSphere. Tap to add me as a friend: ${link}`;
