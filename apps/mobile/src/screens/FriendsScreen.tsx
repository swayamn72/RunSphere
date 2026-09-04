import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { BlockedAccount, FriendRequest, Profile } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton, SettingsGroup } from '../components/primitives';
import { LoopCallout } from '../components/LoopCallout';
import { useLoopGuidance } from '../components/useLoopGuidance';
import type { LoopGuidanceCue } from '../loop-guidance';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  BLOCK_CONSEQUENCE_HINT,
  INVITE_RECORDED_NOTICE,
  blockFailureNotice,
  blockRows,
  friendListState,
  friendRows,
  friendsErrorState,
  friendsStatusMessage,
  inviteFailureNotice,
  requestRows,
  respondFailureNotice,
  validateInviteEmail,
  type FriendsRemoteState
} from './friends-model';

/**
 * Friends, requests, and blocks (milestone 2.9). Every route here shipped with
 * the Foundation gate and had no surface until now, which is why the Play tab
 * could show a friend board and challenges that no account could ever populate.
 *
 * Three properties this screen exists to preserve:
 *
 * - **A friend request is never reported as delivered.** The route answers the
 *   same `202` for a missing account, an existing friend, a pending request,
 *   and a block, so the address cannot be probed (ADR-0007).
 * - **Only the addressee answers.** The list is incoming pending requests; the
 *   API has no outgoing list, and this screen does not invent one.
 * - **A block stays reversible.** Blocking removes the friendship and hides
 *   both accounts from each other, so the blocked list is the only way back —
 *   it is always rendered when it has rows.
 */
interface FriendsData {
  readonly friends: readonly Profile[];
  readonly requests: readonly FriendRequest[];
  readonly blocks: readonly BlockedAccount[];
  readonly state: FriendsRemoteState;
  readonly reload: () => void;
  readonly invite: (email: string) => Promise<string>;
  readonly answer: (requestId: string, accept: boolean) => Promise<string | undefined>;
  readonly block: (accountId: string) => Promise<string | undefined>;
  readonly unblock: (accountId: string) => Promise<string | undefined>;
}

const useFriendsData = (api: MobileApiClient, onSessionExpired: () => void): FriendsData => {
  const [friends, setFriends] = useState<readonly Profile[]>([]);
  const [requests, setRequests] = useState<readonly FriendRequest[]>([]);
  const [blocks, setBlocks] = useState<readonly BlockedAccount[]>([]);
  const [state, setState] = useState<FriendsRemoteState>('loading');
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const expire = useCallback(
    (next: FriendsRemoteState) => {
      if (next === 'session-expired' && !sessionExpirationHandled.current) {
        sessionExpirationHandled.current = true;
        onSessionExpired();
      }
    },
    [onSessionExpired]
  );

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    setState('loading');
    void Promise.all([api.listFriends(), api.listFriendRequests(), api.listBlocks()])
      .then(([nextFriends, nextRequests, nextBlocks]) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setFriends(nextFriends);
        setRequests(nextRequests);
        setBlocks(nextBlocks);
        setState(friendListState(nextFriends, nextRequests));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        const next = friendsErrorState(error);
        setState(next);
        expire(next);
      });
  }, [api, expire]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** Always resolves: the confirmation is identical whatever the server found. */
  const invite = useCallback(
    async (email: string) => {
      try {
        await api.sendFriendRequest({ email });
        return INVITE_RECORDED_NOTICE;
      } catch (error) {
        return inviteFailureNotice(error);
      }
    },
    [api]
  );

  const answer = useCallback(
    async (requestId: string, accept: boolean) => {
      try {
        await api.respondFriendRequest(requestId, accept);
        load();
        return undefined;
      } catch (error) {
        return respondFailureNotice(error);
      }
    },
    [api, load]
  );

  const block = useCallback(
    async (accountId: string) => {
      try {
        await api.blockAccount({ accountId });
        load();
        return undefined;
      } catch (error) {
        return blockFailureNotice(error);
      }
    },
    [api, load]
  );

  const unblock = useCallback(
    async (accountId: string) => {
      try {
        await api.unblockAccount(accountId);
        load();
        return undefined;
      } catch (error) {
        return blockFailureNotice(error);
      }
    },
    [api, load]
  );

  return { friends, requests, blocks, state, reload: load, invite, answer, block, unblock };
};

export function FriendsScreen({
  api,
  onBack,
  onSessionExpired
}: {
  api: MobileApiClient;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { friends, requests, blocks, state, reload, invite, answer, block, unblock } =
    useFriendsData(api, onSessionExpired);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const requestList = useMemo(() => requestRows(requests), [requests]);
  const friendList = useMemo(() => friendRows(friends), [friends]);
  const blockList = useMemo(() => blockRows(blocks), [blocks]);
  const guidanceCandidates = useMemo<readonly LoopGuidanceCue[]>(
    () => (state === 'empty' ? ['friends-empty'] : []),
    [state]
  );
  const guidance = useLoopGuidance(guidanceCandidates);
  const statusMessage = friendsStatusMessage(state, notice, requestList.length);

  const submitInvite = async () => {
    const validation = validateInviteEmail(email);
    if (!validation.ok) {
      setNotice(validation.message);
      return;
    }
    setBusy(true);
    const result = await invite(validation.email);
    setNotice(result);
    // Clearing only on a recorded request keeps a rate-limited attempt
    // retryable without retyping the address.
    if (result === INVITE_RECORDED_NOTICE) setEmail('');
    setBusy(false);
  };

  const act = async (action: Promise<string | undefined>) => {
    setBusy(true);
    setNotice((await action) ?? '');
    setBusy(false);
  };

  return (
    <>
      <BackHeader label="FRIENDS" onBack={onBack} />
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {statusMessage}
      </Text>
      <Text style={styles.eyebrow}>MUTUAL ONLY</Text>
      <Text style={styles.homeTitle}>Friends</Text>
      <Text style={styles.lead}>
        A challenge and the friend board both need a friend on each side. Nobody sees your route,
        pace, or where you went — only the counted minutes you both agree to share.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      {state === 'loading' && <Text style={styles.rowDetail}>Loading friends.</Text>}

      {requestList.length > 0 && (
        <SettingsGroup title="Requests for you">
          {requestList.map((row) => (
            <View key={row.id} style={styles.settingStack}>
              <Text accessibilityLabel={row.accessibilityLabel} style={styles.rowTitle}>
                {row.nameLabel}
              </Text>
              <Text style={styles.rowDetail}>
                Accepting makes you mutual friends. Declining closes this request only.
              </Text>
              <View style={styles.filterRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Accept the friend request from ${row.nameLabel}`}
                  disabled={busy}
                  onPress={() => void act(answer(row.id, true))}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryText}>Accept</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Decline the friend request from ${row.nameLabel}`}
                disabled={busy}
                onPress={() => void act(answer(row.id, false))}
              >
                <Text style={styles.textButton}>Not now</Text>
              </Pressable>
            </View>
          ))}
        </SettingsGroup>
      )}

      <SettingsGroup title="Your friends">
        {friendList.map((row) => (
          <View key={row.accountId} style={styles.contactRow}>
            <View style={styles.flexCopy}>
              <Text accessibilityLabel={row.accessibilityLabel} style={styles.rowTitle}>
                {row.nameLabel}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Block ${row.nameLabel}`}
              accessibilityHint={BLOCK_CONSEQUENCE_HINT}
              disabled={busy}
              onPress={() => void act(block(row.accountId))}
            >
              <Text style={[styles.settingValue, styles.destructive]}>Block</Text>
            </Pressable>
          </View>
        ))}
        {!friendList.length && state !== 'loading' && (
          <Text style={styles.settingsHint}>
            No friends yet. Add someone below with the exact email they signed up with.
          </Text>
        )}
      </SettingsGroup>

      {guidance.cue && <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />}

      <SettingsGroup title="Add a friend">
        <View style={styles.settingStack}>
          <Text style={styles.fieldLabel}>THEIR EMAIL ADDRESS</Text>
          <TextInput
            accessibilityLabel="Friend email address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor={tokens.text.secondary}
            style={styles.input}
            value={email}
          />
          <PrimaryButton
            accessibilityLabel="Send friend request"
            label={busy ? 'Working…' : 'Send friend request'}
            disabled={busy}
            onPress={() => void submitInvite()}
          />
          <Text style={styles.rowDetail}>
            RunSphere answers the same way whether or not that address has an account, so nobody can
            use this to find out who is registered. You will see them in your friends list only if
            they accept.
          </Text>
        </View>
      </SettingsGroup>

      {blockList.length > 0 && (
        <SettingsGroup title="Blocked accounts">
          {blockList.map((row) => (
            <View key={row.accountId} style={styles.contactRow}>
              <View style={styles.flexCopy}>
                <Text accessibilityLabel={row.accessibilityLabel} style={styles.rowTitle}>
                  {row.nameLabel}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${row.nameLabel}`}
                accessibilityHint="They can send you a friend request again. It does not restore the friendship."
                disabled={busy}
                onPress={() => void act(unblock(row.accountId))}
              >
                <Text style={styles.settingValue}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </SettingsGroup>
      )}

      {(state === 'offline' || state === 'error' || state === 'configuration') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {state === 'configuration' ? 'Friends need setup' : 'Friends are unavailable'}
            </Text>
            <Text style={styles.noticeCopy}>
              {state === 'configuration'
                ? 'RunSphere needs an API URL before friends can load.'
                : 'Your friends, requests, and blocks could not load. Nothing was changed.'}
            </Text>
            {state !== 'configuration' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={reload}>
                <Text style={styles.textButton}>Try again</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </>
  );
}
