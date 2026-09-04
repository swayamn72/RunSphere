import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AchievementStatus } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { BackHeader, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import {
  achievementRows,
  achievementsErrorState,
  achievementsState,
  achievementsStatusMessage,
  achievementsSummary,
  syncFailureNotice,
  syncNotice,
  type AchievementsRemoteState
} from './achievements-model';

/**
 * Achievements (milestone 2.9). The list and its earned state are read from
 * the server; nothing here decides that something was earned. Achievements are
 * cosmetic (ADR-0005) and the copy says so, so an achievement is never
 * mistaken for eligibility, validation, or a ranking.
 */
export function AchievementsScreen({
  api,
  onBack,
  onSessionExpired
}: {
  api: MobileApiClient;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const [achievements, setAchievements] = useState<readonly AchievementStatus[]>([]);
  const [state, setState] = useState<AchievementsRemoteState>('loading');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    setState('loading');
    void api
      .getAchievements()
      .then((next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setAchievements(next);
        setState(achievementsState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        const next = achievementsErrorState(error);
        setState(next);
        if (next === 'session-expired' && !sessionExpirationHandled.current) {
          sessionExpirationHandled.current = true;
          onSessionExpired();
        }
      });
  }, [api, onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** Idempotent: the server awards, so pressing this twice changes nothing. */
  const check = async () => {
    setBusy(true);
    try {
      const result = await api.syncAchievements();
      setNotice(syncNotice(result.newlyAwarded));
      load();
    } catch (error) {
      setNotice(syncFailureNotice(error));
    }
    if (mounted.current) setBusy(false);
  };

  const rows = achievementRows(achievements);

  return (
    <>
      <BackHeader label="ACHIEVEMENTS" onBack={onBack} />
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {achievementsStatusMessage(state, notice, achievements)}
      </Text>
      <Text style={styles.eyebrow}>COSMETIC ONLY</Text>
      <Text style={styles.homeTitle}>Achievements</Text>
      <Text style={styles.lead}>
        Awarded by RunSphere from validated activity. They change nothing about eligibility,
        validation, or how anyone is ranked — and none of them depend on pace.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      {state === 'loading' && <Text style={styles.rowDetail}>Loading achievements.</Text>}

      {state === 'ready' && (
        <SettingsGroup title={achievementsSummary(achievements)}>
          {rows.map((row) => (
            <View
              key={row.key}
              accessible
              accessibilityLabel={row.accessibilityLabel}
              style={[styles.settingStack, !row.earned && styles.settingDisabled]}
            >
              <Text style={styles.eyebrow}>
                {row.earned ? `EARNED ${row.earnedOn ?? ''}`.trim() : 'NOT EARNED YET'}
              </Text>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowDetail}>{row.description}</Text>
              <Text style={styles.rowDetail}>{row.rewardLabel}</Text>
            </View>
          ))}
        </SettingsGroup>
      )}

      {state === 'empty' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>No achievements published</Text>
            <Text style={styles.noticeCopy}>
              This deployment has no achievement rules yet. Nothing is missing from your account.
            </Text>
          </View>
        </View>
      )}

      {(state === 'ready' || state === 'empty') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check for new achievements"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void check()}
        >
          <Text style={styles.textButton}>{busy ? 'Checking…' : 'Check for new achievements'}</Text>
        </Pressable>
      )}

      {(state === 'offline' || state === 'error' || state === 'configuration') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {state === 'configuration'
                ? 'Achievements need setup'
                : 'Achievements are unavailable'}
            </Text>
            <Text style={styles.noticeCopy}>
              {state === 'configuration'
                ? 'RunSphere needs an API URL before achievements can load.'
                : 'Your achievements could not load. Nothing was changed.'}
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
