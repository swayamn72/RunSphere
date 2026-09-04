import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Profile } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { AuthFailure } from '../auth-failure';
import { BackHeader, PrimaryButton, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  DISPLAY_NAME_MAX,
  identityErrorState,
  validateDisplayName,
  type IdentityState
} from './profile-model';

/**
 * The display name (milestone 2.9).
 *
 * This is the one identity a social surface may reveal about an account, and
 * nothing created it until now: `GET /v1/profile` answers `404` for an account
 * with no profile row, and a friend request cannot reach an account that has
 * none, because the route joins `profiles`. So an account without a display
 * name was invisible to friends, standings, and challenges.
 *
 * No email, location, or activity detail is part of a profile.
 */
export function ProfileIdentityScreen({
  api,
  onBack,
  onSaved
}: {
  api: MobileApiClient;
  onBack: () => void;
  onSaved?: (profile: Profile) => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [state, setState] = useState<IdentityState>('loading');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(() => {
    setState('loading');
    void api
      .getProfile()
      .then((profile) => {
        if (!mounted.current) return;
        setDraft(profile.displayName);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState(identityErrorState(error));
      });
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const save = async () => {
    const validation = validateDisplayName(draft);
    if (!validation.ok) {
      setNotice(validation.message);
      return;
    }
    setBusy(true);
    try {
      const profile = await api.updateProfile({ displayName: validation.displayName });
      if (mounted.current) {
        setDraft(profile.displayName);
        setState('ready');
        setNotice('Display name saved.');
      }
      onSaved?.(profile);
    } catch (error) {
      setNotice(
        error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls')
          ? 'Saving a display name needs a connection. Nothing changed.'
          : 'That display name could not be saved. Nothing changed.'
      );
    }
    if (mounted.current) setBusy(false);
  };

  return (
    <>
      <BackHeader label="DISPLAY NAME" onBack={onBack} />
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {notice}
      </Text>
      <Text style={styles.eyebrow}>HOW FRIENDS SEE YOU</Text>
      <Text style={styles.homeTitle}>Display name</Text>
      <Text style={styles.lead}>
        Friends, challenges, and the friend board show this name. Until you set one, a friend
        request cannot reach you and you will not appear on a board.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      {state === 'loading' && <Text style={styles.rowDetail}>Loading your display name.</Text>}

      {(state === 'ready' || state === 'unset') && (
        <SettingsGroup title={state === 'unset' ? 'Choose a name' : 'Your name'}>
          <View style={styles.settingStack}>
            <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
            <TextInput
              accessibilityLabel="Display name"
              autoCapitalize="words"
              maxLength={DISPLAY_NAME_MAX}
              onChangeText={setDraft}
              placeholder="Maya"
              placeholderTextColor={tokens.text.secondary}
              style={styles.input}
              value={draft}
            />
            <PrimaryButton
              accessibilityLabel="Save display name"
              label={busy ? 'Saving…' : 'Save display name'}
              disabled={busy}
              onPress={() => void save()}
            />
            <Text style={styles.rowDetail}>
              Up to {DISPLAY_NAME_MAX} characters. Your email address is never shown to anyone.
            </Text>
          </View>
        </SettingsGroup>
      )}

      {(state === 'offline' || state === 'error' || state === 'configuration') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {state === 'configuration' ? 'Profile needs setup' : 'Profile is unavailable'}
            </Text>
            <Text style={styles.noticeCopy}>
              {state === 'configuration'
                ? 'RunSphere needs an API URL before your profile can load.'
                : 'Your display name could not load. Nothing was changed.'}
            </Text>
            {state !== 'configuration' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={load}>
                <Text style={styles.textButton}>Try again</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </>
  );
}
