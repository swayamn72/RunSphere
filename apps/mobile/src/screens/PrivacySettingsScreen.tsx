import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import type {
  IdentityResponse,
  PrivacySettings,
  PrivacySettingsUpdate
} from '@runsphere/contracts';
import { HOME_AREAS } from '@runsphere/domain';
import type { MobileApiClient } from '../api-client';
import { BackHeader, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import { failureMessage } from '../failure-copy';
import {
  AUDIENCE_OPTIONS,
  NEVER_SHARED,
  PROFILE_HELP,
  REQUESTS_FROM_OPTIONS,
  RUNS_HELP,
  TOGGLES,
  applyChange,
  saveFailureMessage,
  usernameHint,
  type ToggleCopy
} from './privacy-settings-model';

type Api = Pick<
  MobileApiClient,
  'getPrivacySettings' | 'savePrivacySettings' | 'getIdentity' | 'saveIdentity'
>;

/**
 * Privacy & visibility (ADR-0014, SI.5): username, home area and every
 * control the server enforces, on one screen. Each change saves on its own;
 * a failed save puts the previous value back.
 */
export function PrivacySettingsScreen({
  api,
  onBack,
  onOpenSafety
}: {
  api: Api;
  onBack: () => void;
  onOpenSafety?: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [settings, setSettings] = useState<PrivacySettings>();
  const [identity, setIdentity] = useState<IdentityResponse>();
  const [username, setUsername] = useState('');
  const [choosingArea, setChoosingArea] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([api.getPrivacySettings(), api.getIdentity()])
      .then(([loaded, who]) => {
        if (!active) return;
        setSettings(loaded);
        setIdentity(who);
        setUsername(who.username);
      })
      .catch((error: unknown) => {
        if (active) setNotice(failureMessage(error, "Couldn't load your settings. Try again."));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const change = async (update: PrivacySettingsUpdate) => {
    if (!settings) return;
    const before = settings;
    setSettings(applyChange(settings, update));
    try {
      setSettings(await api.savePrivacySettings(update));
      setNotice('');
    } catch (error) {
      setSettings(before);
      setNotice(saveFailureMessage(error));
    }
  };

  const saveUsername = async () => {
    try {
      const saved = await api.saveIdentity({ username });
      setIdentity(saved);
      setUsername(saved.username);
      setNotice(`You're @${saved.username} now.`);
    } catch (error) {
      setNotice(failureMessage(error, "Couldn't save that username. Try another."));
    }
  };

  const saveArea = async (homeArea: string | null) => {
    setChoosingArea(false);
    try {
      setIdentity(await api.saveIdentity({ homeArea }));
    } catch (error) {
      setNotice(failureMessage(error, "Couldn't save your area. Try again."));
    }
  };

  const toggleRow = (toggle: ToggleCopy) => (
    <View key={toggle.key} style={styles.setting}>
      <View style={styles.flexCopy}>
        <Text style={styles.rowTitle}>{toggle.label}</Text>
        <Text style={styles.rowDetail}>{toggle.help}</Text>
      </View>
      <Switch
        accessibilityLabel={toggle.label}
        value={settings?.[toggle.key] ?? false}
        disabled={!settings}
        onValueChange={(value) => void change({ [toggle.key]: value })}
        trackColor={{ false: tokens.border.subtle, true: tokens.status.success }}
      />
    </View>
  );

  const choice = <T extends string>(
    label: string,
    options: readonly { value: T; label: string }[],
    selected: T | undefined,
    onPick: (value: T) => void
  ) => (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}: ${option.label}`}
            onPress={() => onPick(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const hint = usernameHint(username);

  return (
    <>
      <BackHeader label="SETTINGS" onBack={onBack} />
      <Text style={styles.homeTitle}>Privacy & visibility</Text>
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.settingsHint}>
          {notice}
        </Text>
      )}

      <SettingsGroup title="You">
        <View style={styles.settingStack}>
          <Text style={styles.fieldLabel}>USERNAME</Text>
          <TextInput
            accessibilityLabel="Your username"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUsername}
            placeholder="@username"
            placeholderTextColor={tokens.text.secondary}
            style={styles.input}
            value={username}
          />
          {hint ? <Text style={styles.rowDetail}>{hint}</Text> : null}
          {identity &&
          username.trim().replace(/^@/, '').toLowerCase() !== identity.username &&
          !hint ? (
            <Pressable accessibilityRole="button" onPress={() => void saveUsername()}>
              <Text style={styles.link}>Save username</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose your area"
          onPress={() => setChoosingArea((open) => !open)}
          style={styles.setting}
        >
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>Your area</Text>
            <Text style={styles.rowDetail}>A neighbourhood, never an address. Optional.</Text>
          </View>
          <Text style={styles.settingValue}>{identity?.homeArea ?? 'Not set'}</Text>
        </Pressable>
        {choosingArea && (
          <View style={styles.filterRow}>
            {identity?.homeArea ? (
              <Pressable accessibilityRole="button" onPress={() => void saveArea(null)}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            ) : null}
            {HOME_AREAS.map((area) => (
              <Pressable
                key={area}
                accessibilityRole="button"
                accessibilityLabel={`Set your area to ${area}`}
                onPress={() => void saveArea(area)}
                style={[styles.segment, identity?.homeArea === area && styles.segmentActive]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    identity?.homeArea === area && styles.segmentTextActive
                  ]}
                >
                  {area}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </SettingsGroup>

      <SettingsGroup title="Who can see you">
        <View style={styles.settingStack}>
          <Text style={styles.rowTitle}>Profile</Text>
          {choice(
            'Profile',
            AUDIENCE_OPTIONS,
            settings?.profileVisibility,
            (value) => void change({ profileVisibility: value })
          )}
          {settings ? (
            <Text style={styles.rowDetail}>{PROFILE_HELP[settings.profileVisibility]}</Text>
          ) : null}
        </View>
        {TOGGLES.discovery.map(toggleRow)}
        <View style={styles.settingStack}>
          <Text style={styles.rowTitle}>Who can send you friend requests</Text>
          {choice(
            'Friend requests',
            REQUESTS_FROM_OPTIONS,
            settings?.friendRequestsFrom,
            (value) => void change({ friendRequestsFrom: value })
          )}
        </View>
      </SettingsGroup>

      <SettingsGroup title="Your runs">
        <View style={styles.settingStack}>
          <Text style={styles.rowTitle}>Who can see your runs</Text>
          {choice(
            'Runs',
            AUDIENCE_OPTIONS,
            settings?.runsVisibility,
            (value) => void change({ runsVisibility: value })
          )}
          <Text style={styles.rowDetail}>{RUNS_HELP}</Text>
        </View>
        {TOGGLES.runs.map(toggleRow)}
        {onOpenSafety ? (
          <View style={styles.settingStack}>
            <Pressable accessibilityRole="button" onPress={onOpenSafety}>
              <Text style={styles.link}>Privacy zones and safety contacts ›</Text>
            </Pressable>
          </View>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Turf">{TOGGLES.turf.map(toggleRow)}</SettingsGroup>
      <SettingsGroup title="Boards">{TOGGLES.boards.map(toggleRow)}</SettingsGroup>

      <Text style={styles.settingsHint}>{NEVER_SHARED}</Text>
    </>
  );
}
