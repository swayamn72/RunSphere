import { useEffect, useRef, useState } from 'react';
import { Pressable, Share, Text, TextInput, View } from 'react-native';
import type { PublicProfile } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { useAppStyles } from '../components/styles';
import { NavigationIcon } from '../components/NavigationIcon';
import { useAppTheme } from '../theme/theme';
import { failureMessage } from '../failure-copy';
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

/** Waits this long after the last keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Find runners by @username and add them, or share an invite link
 * (ADR-0014). Results already respect every runner's privacy settings.
 */
export function RunnerSearch({
  api,
  onOpenProfile
}: {
  api: Pick<MobileApiClient, 'searchRunners' | 'sendFriendRequest' | 'createFriendInvite'>;
  onOpenProfile?: (username: string) => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<readonly PublicProfile[]>([]);
  const [searched, setSearched] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!shouldSearch(typed)) {
      setResults([]);
      setSearched('');
      return;
    }
    const ticket = (latest.current += 1);
    const timer = setTimeout(() => {
      void api
        .searchRunners(searchQuery(typed))
        .then((found) => {
          // Only the newest search may write, so a slow answer can't
          // overwrite the results for what was typed after it.
          if (ticket !== latest.current) return;
          setResults(found);
          setSearched(typed);
          setNotice('');
        })
        .catch((error: unknown) => {
          if (ticket === latest.current)
            setNotice(failureMessage(error, "Couldn't search right now. Try again."));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, typed]);

  const add = async (profile: PublicProfile) => {
    setBusy(true);
    try {
      await api.sendFriendRequest({ username: profile.username });
      setResults((current) => markRequested(current, profile.id));
      setNotice(`Request sent to @${profile.username}.`);
    } catch (error) {
      setNotice(addFailureMessage(error));
    }
    setBusy(false);
  };

  const shareInvite = async () => {
    setBusy(true);
    try {
      const invite = await api.createFriendInvite();
      await Share.share({ message: inviteShareMessage(invite.link) });
    } catch (error) {
      setNotice(failureMessage(error, "Couldn't make an invite link. Try again."));
    }
    setBusy(false);
  };

  return (
    <View style={styles.settingStack}>
      <View style={styles.cardRow}>
        <NavigationIcon name="search" color={tokens.text.secondary} size={18} />
        <Text accessibilityRole="header" style={styles.rowTitle}>
          Find runners
        </Text>
      </View>
      <TextInput
        accessibilityLabel="Search runners by username"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setTyped}
        placeholder="@username"
        placeholderTextColor={tokens.text.secondary}
        style={styles.input}
        value={typed}
      />
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
      {results.map((profile) => {
        const action = runnerAction(profile);
        return (
          <View key={profile.id} style={styles.contactRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${profile.displayName}'s profile`}
              disabled={!onOpenProfile}
              onPress={() => onOpenProfile?.(profile.username)}
              style={styles.flexCopy}
            >
              <Text style={styles.rowTitle}>{profile.displayName}</Text>
              <Text style={styles.rowDetail}>{runnerSubtitle(profile)}</Text>
            </Pressable>
            {action.kind === 'add' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add @${profile.username} as a friend`}
                disabled={busy}
                onPress={() => void add(profile)}
              >
                <Text style={styles.link}>{action.label}</Text>
              </Pressable>
            ) : (
              <Text style={styles.settingValue}>{action.label}</Text>
            )}
          </View>
        );
      })}
      {searched !== '' && results.length === 0 && (
        <Text style={styles.rowDetail}>{searchEmptyMessage(searched)}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share an invite link"
        disabled={busy}
        onPress={() => void shareInvite()}
      >
        <Text style={styles.textButton}>Invite with a link</Text>
      </Pressable>
    </View>
  );
}
