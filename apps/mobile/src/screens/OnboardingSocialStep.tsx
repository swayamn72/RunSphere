import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import { HOME_AREAS } from '@runsphere/domain';
import type { MobileApiClient } from '../api-client';
import { PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { failureMessage } from '../failure-copy';
import {
  AUDIENCE_OPTIONS,
  PROFILE_HELP,
  RUNS_ALWAYS_CUT,
  RUNS_HELP,
  type Audience
} from './privacy-settings-model';

type Api = Pick<MobileApiClient, 'savePrivacySettings' | 'saveIdentity' | 'createPrivacyZone'>;

/** The phone's current position, or undefined when permission is refused. */
export type CaptureLocation = () => Promise<{ latitude: number; longitude: number } | undefined>;

/**
 * Sign-up's "Who can see you" step (ADR-0014, SI.4): profile visibility with
 * Everyone pre-selected, who sees your runs with Friends pre-selected (ADR-0015,
 * M9 9.27), an optional area, and the offer to hide home or work from routes. Nothing here blocks: every choice can be changed later in
 * Privacy & visibility, and a failed save still lets the runner continue.
 */
export function OnboardingSocialStep({
  api,
  captureLocation,
  onDone
}: {
  api: Api;
  captureLocation: CaptureLocation;
  onDone: () => void;
}) {
  const styles = useAppStyles();
  const [audience, setAudience] = useState<Audience>('everyone');
  const [runsAudience, setRunsAudience] = useState<Audience>('friends');
  const [area, setArea] = useState<string>();
  const [showAreas, setShowAreas] = useState(false);
  const [zoneNote, setZoneNote] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const hideHome = async () => {
    setBusy(true);
    try {
      const center = await captureLocation();
      if (!center) {
        setZoneNote('Location is off, so you can add this later in Privacy & visibility.');
      } else {
        await api.createPrivacyZone({ name: 'Home', center });
        setZoneNote('Done. Anything within 200 m of here stays off your maps and Turf.');
      }
    } catch (error) {
      setZoneNote(failureMessage(error, "Couldn't save that. You can add it later in settings."));
    }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true);
    try {
      // A public profile shows its name on held ground; friends-only and
      // only-me profiles start anonymous there and out of search (ADR-0014).
      await api.savePrivacySettings({
        profileVisibility: audience,
        runsVisibility: runsAudience,
        searchable: audience !== 'only_me',
        nameOnGround: audience === 'everyone'
      });
      if (area) await api.saveIdentity({ homeArea: area });
    } catch (error) {
      setNotice(failureMessage(error, "Couldn't save that now. You can change it in settings."));
    }
    setBusy(false);
    onDone();
  };

  return (
    <View>
      <Text style={styles.eyebrow}>STEP 2 OF 3</Text>
      <Text style={styles.onboardingTitle}>Who can see you?</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="Profile">
        {AUDIENCE_OPTIONS.map((option) => {
          const active = option.value === audience;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Profile: ${option.label}`}
              onPress={() => setAudience(option.value)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.lead}>{PROFILE_HELP[audience]}</Text>

      <Text style={styles.fieldLabel}>WHO SEES YOUR RUNS</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="Runs">
        {AUDIENCE_OPTIONS.map((option) => {
          const active = option.value === runsAudience;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Runs: ${option.label}`}
              onPress={() => setRunsAudience(option.value)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.lead}>{`${RUNS_HELP[runsAudience]} ${RUNS_ALWAYS_CUT}`}</Text>

      <Text style={styles.fieldLabel}>YOUR AREA (OPTIONAL)</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose your area"
        onPress={() => setShowAreas((open) => !open)}
      >
        <Text style={styles.textButton}>{area ?? 'Pick a neighbourhood'}</Text>
      </Pressable>
      {showAreas && (
        <View style={styles.filterRow}>
          {HOME_AREAS.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={`Set your area to ${name}`}
              onPress={() => {
                setArea(name);
                setShowAreas(false);
              }}
              style={[styles.segment, area === name && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, area === name && styles.segmentTextActive]}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.fieldLabel}>HIDE YOUR HOME OR WORK</Text>
      <Text style={styles.lead}>
        Most runs start at your door. Hide 200 m around here from your routes and Turf.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide 200 metres around where I am now"
        disabled={busy}
        onPress={() => void hideHome()}
      >
        <Text style={styles.textButton}>Hide where I am now</Text>
      </Pressable>
      {zoneNote !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {zoneNote}
        </Text>
      )}
      {notice !== '' && <Text style={styles.rowDetail}>{notice}</Text>}

      <PrimaryButton
        label={busy ? 'Saving…' : 'Continue'}
        disabled={busy}
        onPress={() => void finish()}
      />
      <Text style={styles.rowDetail}>
        You can change all of this later in Privacy & visibility.
      </Text>
    </View>
  );
}
