import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { GhostTraceResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { MapSurface } from '../maps/MapSurface';
import {
  ghostConfirmation,
  ghostErrorState,
  ghostPreviewLayers,
  ghostRunFrom,
  ghostStateMessage,
  type GhostRun,
  type GhostState
} from './ghost-race-model';

/**
 * The Ghost Race confirmation (`screens.md` 1.4).
 *
 * **It fetches on open, not on confirm.** The hourly budget is spent by asking
 * for the trace, so the sheet has to be the thing that asks — a sheet that
 * showed the numbers first and fetched on "Start" would either need a second
 * request or would have already spent one to fill itself in. Opening this is
 * the decision that costs a view, and the button below says so.
 *
 * Every refusal here ends in the same place: you can still run the loop. The
 * ghost changes nothing about the contest, so nothing about it should ever
 * read as a blocked run.
 */
export function GhostRaceSheet({
  api,
  claimId,
  holderName,
  onStart,
  onCancel,
  onSessionExpired
}: {
  api: MobileApiClient;
  claimId: string;
  holderName: string;
  onStart: (run: GhostRun) => void;
  onCancel: () => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const [state, setState] = useState<GhostState>('loading');
  const [trace, setTrace] = useState<GhostTraceResponse>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void api
      .getGhostTrace(claimId)
      .then((response) => {
        if (cancelled || !mounted.current) return;
        setTrace(response);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled || !mounted.current) return;
        const next = ghostErrorState(error);
        if (next === 'session-expired') onSessionExpired();
        else setState(next);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
    // Fetching again on any other change would spend another of three views
    // an hour, so this deliberately keys on the claim alone.
  }, [api, claimId]);

  const run = useMemo(() => (trace ? ghostRunFrom(trace) : undefined), [trace]);
  const confirmation = useMemo(() => (trace ? ghostConfirmation(trace) : undefined), [trace]);
  const layers = useMemo(() => (run ? ghostPreviewLayers(run) : []), [run]);

  return (
    <View style={styles.flexCopy}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {confirmation?.title ?? `Race ${holderName}'s ghost`}
      </Text>

      {state === 'ready' && run && confirmation ? (
        <>
          <View style={styles.routePreviewMap} importantForAccessibility="no-hide-descendants">
            <MapSurface
              localLayers={layers}
              accessibilityLabel={`The route ${holderName} ran, trimmed at both ends.`}
              showAttribution={false}
              {...(run.trace.points[0]
                ? {
                    initialCenter: [
                      run.trace.points[0].longitude,
                      run.trace.points[0].latitude
                    ] as [number, number]
                  }
                : {})}
            />
          </View>
          <Text style={styles.lead}>{confirmation.pace}</Text>
          <Text style={styles.rowDetail}>{confirmation.recorded}</Text>
          {/* Both notes, every time. What was trimmed is what the holder is
              trusting the app about, and that a ghost changes no rule is what
              stops it reading as a shortcut. */}
          <Text style={styles.privateNote}>{confirmation.privacyNote}</Text>
          <Text style={styles.privateNote}>{confirmation.rulesNote}</Text>
          {trace?.viewsRemaining === 0 ? (
            <Text style={styles.rowDetail}>That was your last ghost race this hour.</Text>
          ) : null}
          <PrimaryButton label="Start ghost race" onPress={() => onStart(run)} />
        </>
      ) : (
        <Text style={styles.lead} accessibilityLiveRegion="polite">
          {ghostStateMessage(state)}
        </Text>
      )}

      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel}>
        <Text style={styles.textButton}>Cancel</Text>
      </Pressable>
    </View>
  );
}
