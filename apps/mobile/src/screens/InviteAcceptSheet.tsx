import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { FriendInvitePreview } from '@runsphere/contracts';
import { ApiFailure, type MobileApiClient } from '../api-client';
import { PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { failureMessage } from '../failure-copy';

export const INVITE_EXPIRED = 'This invite has expired. Ask your friend for a new one.';

export const inviteFailureMessage = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 404
    ? INVITE_EXPIRED
    : error instanceof ApiFailure && error.status === 409
      ? "That's your own invite. Share it with a friend."
      : failureMessage(error, "Couldn't open this invite. Try again.");

/**
 * What opening a friend's invite link shows: who invited you, and a button to
 * become friends (ADR-0014, SI.3). Sharing the link was their consent, so
 * accepting is all it takes.
 */
export function InviteAcceptSheet({
  api,
  token,
  onClose
}: {
  api: Pick<MobileApiClient, 'previewFriendInvite' | 'acceptFriendInvite'>;
  token: string;
  onClose: () => void;
}) {
  const styles = useAppStyles();
  const [preview, setPreview] = useState<FriendInvitePreview>();
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .previewFriendInvite(token)
      .then((found) => {
        if (active) setPreview(found);
      })
      .catch((error: unknown) => {
        if (active) setNotice(inviteFailureMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api, token]);

  const accept = async () => {
    setBusy(true);
    try {
      await api.acceptFriendInvite(token);
      setDone(true);
    } catch (error) {
      setNotice(inviteFailureMessage(error));
    }
    setBusy(false);
  };

  const inviter = preview?.inviter;
  return (
    <View style={styles.recordCard}>
      <Text style={styles.eyebrow}>FRIEND INVITE</Text>
      {inviter ? (
        <>
          <Text accessibilityRole="header" style={styles.recordTitle}>
            {done
              ? `You and ${inviter.displayName} are friends`
              : `${inviter.displayName} invited you`}
          </Text>
          <Text style={styles.rowDetail}>{`@${inviter.username}`}</Text>
          {!done && (
            <PrimaryButton
              label={busy ? 'Adding…' : 'Become friends'}
              disabled={busy}
              onPress={() => void accept()}
            />
          )}
        </>
      ) : notice === '' ? (
        <Text style={styles.rowDetail}>Opening the invite…</Text>
      ) : null}
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <Text style={styles.textButton}>{done || !inviter ? 'Done' : 'Not now'}</Text>
      </Pressable>
    </View>
  );
}
