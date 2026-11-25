import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import { LEGAL_POLICY_VERSION } from '@runsphere/domain';
import type { MobileApiClient } from '../api-client';
import { PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { legalLinks } from './legal-model';
import { AUDIENCE_OPTIONS, RUNS_HELP, type Audience } from './privacy-settings-model';
import {
  RUNS_PROMPT_AGREE,
  RUNS_PROMPT_LINES,
  RUNS_PROMPT_NOTE,
  RUNS_PROMPT_TITLE,
  agreeToRunsSharing,
  initialRunsAudience,
  type PromptApi
} from './runs-sharing-prompt-model';

/** The one-time "Who sees your runs?" step (M9 9.27); see `runs-sharing-prompt-model.ts`. */
export function RunsSharingPrompt({
  api,
  onDone,
  onSignOut
}: {
  api: PromptApi & Pick<MobileApiClient, 'legalPageUrl'>;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const styles = useAppStyles();
  const [current, setCurrent] = useState<Audience>('friends');
  const [chosen, setChosen] = useState<Audience>('friends');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const legal = legalLinks((page) => api.legalPageUrl(page));

  useEffect(() => {
    let active = true;
    void api
      .getPrivacySettings()
      .then((settings) => {
        if (!active) return;
        const start = initialRunsAudience(settings);
        setCurrent(start);
        setChosen(start);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const agree = async () => {
    setBusy(true);
    setNotice('');
    const failure = await agreeToRunsSharing(api, LEGAL_POLICY_VERSION, chosen, current);
    setBusy(false);
    if (failure) setNotice(failure);
    else onDone();
  };

  return (
    <View accessibilityViewIsModal>
      <Text style={styles.eyebrow}>NEW: RUNS ON PROFILES</Text>
      <Text accessibilityRole="header" style={styles.onboardingTitle}>
        {RUNS_PROMPT_TITLE}
      </Text>
      {RUNS_PROMPT_LINES.map((line) => (
        <Text key={line} style={styles.lead}>
          {line}
        </Text>
      ))}
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="Runs">
        {AUDIENCE_OPTIONS.map((option) => {
          const active = option.value === chosen;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Runs: ${option.label}`}
              onPress={() => setChosen(option.value)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.rowDetail}>{RUNS_HELP[chosen]}</Text>
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
      <PrimaryButton
        label={busy ? 'Saving…' : RUNS_PROMPT_AGREE}
        disabled={busy}
        onPress={() => void agree()}
      />
      <Text style={styles.rowDetail}>{RUNS_PROMPT_NOTE}</Text>
      {legal.map((link) => (
        <Pressable
          key={link.page}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(link.url)}
        >
          <Text style={styles.textButton}>{link.label}</Text>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={onSignOut}>
        <Text style={styles.textButton}>Sign out</Text>
      </Pressable>
    </View>
  );
}
