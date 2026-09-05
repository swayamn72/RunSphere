import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import type { InboxEntry, NotificationPreferences } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  NOTIFICATION_CATEGORY_HINT,
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_CATEGORY_ORDER,
  NOTIFICATION_TARGET_LABEL,
  PUSH_UNAVAILABLE_HINT,
  hasPreferenceEdits,
  inboxRows,
  inboxState,
  notificationsErrorState,
  notificationsStatusMessage,
  parseDailyCap,
  preferencesDiff,
  quietHoursSummary,
  setPushEnabled,
  setQuietHoursEdge,
  setQuietHoursEnabled,
  setMarketingConsent,
  toggleCategory,
  unreadIds,
  MARKETING_CONSENT_HINT,
  type NotificationsRemoteState,
  type NotificationTarget
} from './notifications-model';

/**
 * The notification inbox and its delivery preferences (milestone 2.9).
 *
 * The inbox is the delivery of record (ADR-0009). A push carries only an id
 * and a deep link, so this is the screen that actually shows what happened,
 * and it works with push switched off or unavailable.
 *
 * Entries are marked read only when the account opens this screen, never by a
 * background refresh: "read" should mean a person saw it.
 */
interface NotificationsData {
  readonly entries: readonly InboxEntry[];
  readonly state: NotificationsRemoteState;
  readonly saved: NotificationPreferences | undefined;
  readonly reload: () => void;
  readonly markRead: (ids: readonly string[]) => Promise<void>;
  readonly save: (preferences: NotificationPreferences) => Promise<string | undefined>;
}

const useNotificationsData = (
  api: MobileApiClient,
  onSessionExpired: () => void
): NotificationsData => {
  const [entries, setEntries] = useState<readonly InboxEntry[]>([]);
  const [state, setState] = useState<NotificationsRemoteState>('loading');
  const [saved, setSaved] = useState<NotificationPreferences>();
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    setState('loading');
    void Promise.all([api.getNotificationInbox(), api.getNotificationPreferences()])
      .then(([nextEntries, nextPreferences]) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setEntries(nextEntries);
        setSaved(nextPreferences);
        setState(inboxState(nextEntries));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        const next = notificationsErrorState(error);
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

  /** Best effort: failing to mark read must not hide the entries themselves. */
  const markRead = useCallback(
    async (ids: readonly string[]) => {
      if (!ids.length) return;
      try {
        await api.markNotificationsRead(ids);
        if (!mounted.current) return;
        const readAt = new Date().toISOString();
        setEntries((current) =>
          current.map((entry) => (ids.includes(entry.id) ? { ...entry, readAt } : entry))
        );
      } catch {
        // The server keeps the unread state; the next open tries again.
      }
    },
    [api]
  );

  const save = useCallback(
    async (preferences: NotificationPreferences) => {
      try {
        const next = await api.updateNotificationPreferences(
          preferencesDiff(saved ?? preferences, preferences)
        );
        if (mounted.current) setSaved(next);
        return undefined;
      } catch {
        return 'Those notification settings could not be saved. Nothing changed.';
      }
    },
    [api, saved]
  );

  return { entries, state, saved, reload: load, markRead, save };
};

export function NotificationsScreen({
  api,
  onBack,
  onOpenTarget,
  onSessionExpired
}: {
  api: MobileApiClient;
  onBack: () => void;
  /** Navigates to the only two destinations an entry can honestly reach. */
  onOpenTarget: (target: NotificationTarget) => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { entries, state, saved, reload, markRead, save } = useNotificationsData(
    api,
    onSessionExpired
  );
  const [edited, setEdited] = useState<NotificationPreferences>();
  const [capDraft, setCapDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const markedFor = useRef<string | undefined>(undefined);

  // Adopt server preferences once, then keep local edits until they are saved.
  useEffect(() => {
    if (saved && !edited) {
      setEdited(saved);
      setCapDraft(String(saved.maxPerDay));
    }
  }, [saved, edited]);

  const rows = useMemo(() => inboxRows(entries), [entries]);
  const unread = useMemo(() => unreadIds(entries), [entries]);

  // Reading the screen is what marks entries read, and only once per set.
  useEffect(() => {
    if (state !== 'ready' || !unread.length) return;
    const key = unread.join(',');
    if (markedFor.current === key) return;
    markedFor.current = key;
    void markRead(unread);
  }, [state, unread, markRead]);

  const dirty = saved && edited ? hasPreferenceEdits(saved, edited) : false;
  const statusMessage = notificationsStatusMessage(state, notice, unread.length);

  const commit = async () => {
    if (!edited) return;
    setBusy(true);
    setNotice((await save(edited)) ?? 'Notification settings saved.');
    setBusy(false);
  };

  const editCap = (raw: string) => {
    setCapDraft(raw);
    const parsed = parseDailyCap(raw);
    if (parsed !== undefined && edited) setEdited({ ...edited, maxPerDay: parsed });
  };

  return (
    <>
      <BackHeader label="NOTIFICATIONS" onBack={onBack} />
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {statusMessage}
      </Text>
      <Text style={styles.eyebrow}>YOUR INBOX</Text>
      <Text style={styles.homeTitle}>Notifications</Text>
      <Text style={styles.lead}>
        Everything RunSphere sends you arrives here, whether or not a push reaches your phone. A
        notification never carries your route, pace, or location.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      {state === 'loading' && <Text style={styles.rowDetail}>Loading notifications.</Text>}

      {state === 'empty' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Nothing yet</Text>
            <Text style={styles.noticeCopy}>
              Friend requests and challenge updates will appear here.
            </Text>
          </View>
        </View>
      )}

      {rows.length > 0 && (
        <SettingsGroup title="Recent">
          {rows.map((row) => (
            <View key={row.id} style={styles.settingStack}>
              <View
                accessible
                accessibilityLabel={row.accessibilityLabel}
                style={styles.cardTopline}
              >
                <View style={styles.flexCopy}>
                  <Text style={[styles.eyebrow, !row.unread && styles.muted]}>
                    {row.kindLabel.toUpperCase()}
                    {row.unread ? ' · NEW' : ''}
                  </Text>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowDetail}>{row.body}</Text>
                </View>
                <Text style={styles.settingValue}>{row.ageLabel}</Text>
              </View>
              {row.target && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={NOTIFICATION_TARGET_LABEL[row.target]}
                  onPress={() => onOpenTarget(row.target!)}
                >
                  <Text style={styles.textButton}>{NOTIFICATION_TARGET_LABEL[row.target]} ›</Text>
                </Pressable>
              )}
            </View>
          ))}
        </SettingsGroup>
      )}

      {edited && (
        <>
          <SettingsGroup title="What you hear about">
            {NOTIFICATION_CATEGORY_ORDER.map((category) => (
              <View key={category} style={styles.setting}>
                <View style={styles.flexCopy}>
                  <Text style={styles.rowTitle}>{NOTIFICATION_CATEGORY_LABEL[category]}</Text>
                  {NOTIFICATION_CATEGORY_HINT[category] && (
                    <Text style={styles.rowDetail}>{NOTIFICATION_CATEGORY_HINT[category]}</Text>
                  )}
                </View>
                <Switch
                  accessibilityLabel={NOTIFICATION_CATEGORY_LABEL[category]}
                  onValueChange={() => setEdited(toggleCategory(edited, category))}
                  value={edited.categories[category] === true}
                />
              </View>
            ))}
          </SettingsGroup>

          <SettingsGroup title="How you hear about it">
            <View style={styles.setting}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>Push to this phone</Text>
                <Text style={styles.rowDetail}>{PUSH_UNAVAILABLE_HINT}</Text>
              </View>
              <Switch
                accessibilityLabel="Push to this phone"
                onValueChange={(next) => setEdited(setPushEnabled(edited, next))}
                value={edited.channels.push}
              />
            </View>
            <View style={styles.setting}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>Product news by email</Text>
                <Text style={styles.rowDetail}>{MARKETING_CONSENT_HINT}</Text>
              </View>
              <Switch
                accessibilityLabel="Product news by email"
                onValueChange={(next) => setEdited(setMarketingConsent(edited, next))}
                value={edited.marketingConsent}
              />
            </View>
            <View style={styles.setting}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>Quiet hours</Text>
                <Text style={styles.rowDetail}>{quietHoursSummary(edited)}</Text>
              </View>
              <Switch
                accessibilityLabel="Quiet hours"
                onValueChange={(next) => setEdited(setQuietHoursEnabled(edited, next))}
                value={edited.quietHours !== undefined}
              />
            </View>
            {edited.quietHours && (
              <View style={styles.settingStack}>
                <Text style={styles.fieldLabel}>QUIET FROM</Text>
                <TextInput
                  accessibilityLabel="Quiet hours start, 24 hour clock"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={(value) => setEdited(setQuietHoursEdge(edited, 'start', value))}
                  placeholder="22:00"
                  placeholderTextColor={tokens.text.secondary}
                  style={styles.input}
                  value={edited.quietHours.start}
                />
                <Text style={styles.fieldLabel}>QUIET UNTIL</Text>
                <TextInput
                  accessibilityLabel="Quiet hours end, 24 hour clock"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={(value) => setEdited(setQuietHoursEdge(edited, 'end', value))}
                  placeholder="07:00"
                  placeholderTextColor={tokens.text.secondary}
                  style={styles.input}
                  value={edited.quietHours.end}
                />
                <Text style={styles.rowDetail}>
                  Quiet hours hold a push back; the notification still arrives in this inbox.
                </Text>
              </View>
            )}
            <View style={styles.settingStack}>
              <Text style={styles.fieldLabel}>MOST PUSHES PER DAY</Text>
              <TextInput
                accessibilityLabel="Most pushes per day"
                keyboardType="number-pad"
                onChangeText={editCap}
                placeholder="50"
                placeholderTextColor={tokens.text.secondary}
                style={styles.input}
                value={capDraft}
              />
              <Text style={styles.rowDetail}>
                Between 1 and 200. Beyond the cap a notification still arrives here, without waking
                your phone.
              </Text>
            </View>
          </SettingsGroup>

          <PrimaryButton
            accessibilityLabel="Save notification settings"
            label={busy ? 'Saving…' : 'Save notification settings'}
            disabled={busy || !dirty}
            onPress={() => void commit()}
          />
        </>
      )}

      {(state === 'offline' || state === 'error' || state === 'configuration') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {state === 'configuration'
                ? 'Notifications need setup'
                : 'Notifications are unavailable'}
            </Text>
            <Text style={styles.noticeCopy}>
              {state === 'configuration'
                ? 'RunSphere needs an API URL before notifications can load.'
                : 'Your inbox and settings could not load. Nothing was changed.'}
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
