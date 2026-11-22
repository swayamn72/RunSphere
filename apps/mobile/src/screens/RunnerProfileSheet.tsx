import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PublicProfile } from '@runsphere/contracts';
import { ApiFailure, type MobileApiClient } from '../api-client';
import { useAppStyles } from '../components/styles';
import { ReportPanel } from '../components/ReportPanel';
import { REPORT_CONSEQUENCE_HINT } from './moderation-model';
import { failureMessage } from '../failure-copy';
import { RunLogSection } from './RunLogSection';
import { useOpenRun } from './RunDetailHost';
import {
  addFailureMessage,
  markRequested,
  runnerAction,
  runnerSubtitle
} from './runner-search-model';

/** Two initials from a display name, for the avatar circle. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';

/** Why a profile can't be shown: hidden and missing read the same (ADR-0014). */
export const profileUnavailableMessage = (error: unknown): string =>
  error instanceof ApiFailure && error.status === 404
    ? "This runner's profile is private."
    : failureMessage(error, "Couldn't open this profile. Try again.");

/**
 * A runner's public profile (ADR-0014, SI.6), opened from search or from a
 * name on Turf. Shows only what the server returned for this reader.
 */
export function RunnerProfileSheet({
  api,
  username,
  onClose
}: {
  api: Pick<
    MobileApiClient,
    'getRunnerProfile' | 'getRunnerRuns' | 'sendFriendRequest' | 'fileReport'
  >;
  username: string;
  onClose: () => void;
}) {
  const styles = useAppStyles();
  const [profile, setProfile] = useState<PublicProfile>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile(undefined);
    setNotice('');
    void api
      .getRunnerProfile(username)
      .then((found) => {
        if (active) setProfile(found);
      })
      .catch((error: unknown) => {
        if (active) setNotice(profileUnavailableMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api, username]);

  const add = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      await api.sendFriendRequest({ username: profile.username });
      setProfile(markRequested([profile], profile.id)[0]);
      setNotice('Request sent.');
    } catch (error) {
      setNotice(addFailureMessage(error));
    }
    setBusy(false);
  };

  const action = profile ? runnerAction(profile) : undefined;
  const openRun = useOpenRun();
  const loadRuns = useCallback(
    (cursor?: string) => api.getRunnerRuns(username, cursor),
    [api, username]
  );

  return (
    <View style={styles.recordCard} accessibilityViewIsModal>
      <View style={styles.contactRow}>
        <Text style={styles.eyebrow}>RUNNER</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close profile" onPress={onClose}>
          <Text style={styles.textButton}>Close</Text>
        </Pressable>
      </View>
      {profile ? (
        <>
          <View style={styles.bigAvatar}>
            <Text style={styles.bigAvatarText}>{initialsOf(profile.displayName)}</Text>
          </View>
          <Text accessibilityRole="header" style={styles.profileName}>
            {profile.displayName}
          </Text>
          <Text style={styles.profileHandle}>{runnerSubtitle(profile)}</Text>
          {action?.kind === 'add' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add @${profile.username} as a friend`}
              disabled={busy}
              onPress={() => void add()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>Add friend</Text>
            </Pressable>
          ) : action ? (
            <Text style={styles.settingValue}>{action.label}</Text>
          ) : null}
          {profile.relationship !== 'self' &&
            (reporting ? (
              <ReportPanel
                api={api}
                subject={{ type: 'account', id: profile.id, nameLabel: `@${profile.username}` }}
                onFinished={(next, sent) => {
                  setNotice(next);
                  if (sent) setReporting(false);
                }}
                onCancel={() => setReporting(false)}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Report @${profile.username}`}
                accessibilityHint={REPORT_CONSEQUENCE_HINT}
                onPress={() => setReporting(true)}
              >
                <Text style={styles.textButton}>Report</Text>
              </Pressable>
            ))}
          <RunLogSection
            load={loadRuns}
            owner={profile.relationship === 'self'}
            {...(openRun
              ? {
                  onOpenRun: (item, origin, measureOrigin) =>
                    openRun({
                      item,
                      owner: profile.relationship === 'self',
                      origin,
                      measureOrigin
                    })
                }
              : {})}
          />
        </>
      ) : notice === '' ? (
        <Text style={styles.rowDetail}>Loading…</Text>
      ) : null}
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
    </View>
  );
}
