import type { BlockedAccount, FriendRequest, Profile } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';

/**
 * Friends, requests, and blocks (milestone 2.9). Every route this screen calls
 * already shipped in the Foundation gate; nothing here derives social state
 * locally, and nothing reveals an email address.
 *
 * The one rule that shapes the whole surface: `POST /v1/friends/requests`
 * answers `202 recorded` whatever happens — no account, already a friend,
 * already pending, or blocked in either direction all look identical, so the
 * address cannot be probed (ADR-0007). The UI must therefore never claim a
 * request reached anyone.
 */

export type FriendsRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export const friendsErrorState = (error: unknown): FriendsRemoteState => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const friendListState = (
  friends: readonly Profile[],
  requests: readonly FriendRequest[]
): FriendsRemoteState => (friends.length || requests.length ? 'ready' : 'empty');

/** Requests the account must answer. The route returns incoming pending only. */
export const answerableRequests = (requests: readonly FriendRequest[]): readonly FriendRequest[] =>
  requests.filter((request) => request.status === 'pending');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteValidation =
  { readonly ok: true; readonly email: string } | { readonly ok: false; readonly message: string };

/**
 * Local validation only rejects what cannot be an address, so the client never
 * spends a rate-limited attempt on an obvious typo. It deliberately makes no
 * claim about whether the address belongs to anyone.
 */
export const validateInviteEmail = (raw: string): InviteValidation => {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, message: 'Enter the email address your friend signed up with.' };
  if (email.length > 320) return { ok: false, message: 'That address is too long to be valid.' };
  if (!EMAIL_PATTERN.test(email))
    return { ok: false, message: 'That does not look like an email address.' };
  return { ok: true, email };
};

/**
 * The only honest confirmation: the request was recorded if such an account
 * exists and could receive it. Saying "sent" would leak that the address is
 * registered; saying "not found" would leak the opposite.
 */
export const INVITE_RECORDED_NOTICE =
  'Request recorded. If that address belongs to a RunSphere account that can receive it, it will appear in their requests. You will see them in your friends list once they accept.';

export const inviteFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 429)
    return 'Too many friend requests just now. Try again in a minute.';
  // A moderation decision arrives as a `403` carrying the statement staff
  // wrote. Showing it beats a generic failure: the member learns why, in the
  // words of the decision, rather than being left to guess.
  if (error instanceof ApiFailure && error.status === 403) return error.message;
  if (error instanceof AuthFailure) {
    if (error.kind === 'network' || error.kind === 'tls')
      return 'Friend requests need a connection. Nothing was sent.';
    if (error.kind === 'configuration')
      return 'Friend requests are unavailable until RunSphere is configured.';
  }
  return 'That request could not be recorded. Nothing was sent.';
};

export const respondFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 404)
    return 'That request is no longer open. Pull to refresh.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Answering a request needs a connection. Nothing changed.';
  return 'That request could not be answered. Nothing changed.';
};

export const blockFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 404)
    return 'That account is no longer available. Nothing changed.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Blocking needs a connection. Nothing changed.';
  return 'That block could not be saved. Nothing changed.';
};

export interface FriendRow {
  readonly accountId: string;
  readonly nameLabel: string;
  readonly accessibilityLabel: string;
}

/** A profile with no display name still has to be addressable in a list. */
const nameOf = (profile: Profile): string => profile.displayName || 'RunSphere member';

export const friendRows = (friends: readonly Profile[]): readonly FriendRow[] =>
  [...friends]
    .sort((left, right) => nameOf(left).localeCompare(nameOf(right)))
    .map((profile) => ({
      accountId: profile.id,
      nameLabel: nameOf(profile),
      accessibilityLabel: `${nameOf(profile)}. Friend.`
    }));

export interface RequestRow {
  readonly id: string;
  readonly nameLabel: string;
  readonly accessibilityLabel: string;
}

export const requestRows = (requests: readonly FriendRequest[]): readonly RequestRow[] =>
  answerableRequests(requests).map((request) => ({
    id: request.id,
    nameLabel: nameOf(request.counterpartProfile),
    accessibilityLabel: `${nameOf(request.counterpartProfile)} sent you a friend request.`
  }));

export interface BlockRow {
  readonly accountId: string;
  readonly nameLabel: string;
  readonly accessibilityLabel: string;
}

export const blockRows = (blocks: readonly BlockedAccount[]): readonly BlockRow[] =>
  blocks.map((block) => ({
    accountId: block.profile.id,
    nameLabel: nameOf(block.profile),
    accessibilityLabel: `${nameOf(block.profile)}. Blocked.`
  }));

/**
 * Home keeps one live region and so does this screen: the caller passes an
 * already-derived message so a screen reader hears one summary, not three.
 */
export const friendsStatusMessage = (
  state: FriendsRemoteState,
  notice: string,
  requestCount: number
): string => {
  if (notice) return notice;
  if (state === 'configuration') return 'Friends are unavailable until RunSphere is configured.';
  if (state === 'loading') return 'Loading friends.';
  if (state === 'offline') return 'Friends are unavailable offline.';
  if (state === 'error') return 'Friends are unavailable.';
  if (requestCount === 1) return 'One friend request is waiting on your answer.';
  if (requestCount > 1) return `${requestCount} friend requests are waiting on your answer.`;
  return '';
};

/**
 * Declining and blocking are different actions and both are offered: a decline
 * closes this one request, a block also stops future ones and removes any
 * friendship. Blocking is safe from either list because `GET /v1/blocks` can
 * still name the account afterwards, which is what keeps it reversible.
 */
export const BLOCK_CONSEQUENCE_HINT =
  'Blocking removes the friendship, cancels pending requests both ways, and hides you from each other. You can undo it from Blocked accounts.';
