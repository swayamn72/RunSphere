import { useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { getLocationPermissionState, type LocationPermissionState } from '../location-permission';
import { MapSurface } from '../maps/MapSurface';
import {
  MAX_TARGET_METRES,
  MIN_TARGET_METRES,
  canStepTarget,
  clampSelectedIndex,
  formatRouteDistance,
  loopCentre,
  parseMinutesInput,
  routeGuideFrom,
  routePreviewCards,
  routePreviewErrorStateFor,
  routePreviewLayers,
  routePreviewStateFor,
  stepTargetMetres,
  targetReasonMessage,
  unavailableMessage,
  type RouteGuide,
  type RoutePreviewCard,
  type RoutePreviewState
} from './route-preview-model';

/**
 * Choosing a route before a run (`map-ux.md` section 2; `screens.md` 3.1).
 *
 * Two things this screen deliberately does not do:
 *
 *   * **It does not reshape a loop.** Pressing + asks the server for a longer
 *     published loop rather than scaling the one on screen, because a scaled
 *     loop is one nobody reviewed (`041_curated_routes.sql`).
 *   * **It does not treat starting without a route as a rejection.** Declining
 *     rests a loop for a month; somebody who just wants to run today has not
 *     rejected anything, so only the per-card "Not this one" declines.
 */
export function RoutePreviewScreen({
  api,
  onUseRoute,
  onStartWithout,
  onBack,
  onSessionExpired
}: {
  api: MobileApiClient;
  onUseRoute: (guide: RouteGuide) => void;
  onStartWithout: () => void;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const [state, setState] = useState<RoutePreviewState>('idle');
  const [cards, setCards] = useState<readonly RoutePreviewCard[]>([]);
  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState<string>();
  const [unavailable, setUnavailable] = useState<string>();
  const [target, setTarget] = useState<number>();
  const [minutesText, setMinutesText] = useState('');
  const [minutesError, setMinutesError] = useState<string>();
  const [permission, setPermission] = useState<LocationPermissionState>('idle');
  const mounted = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  /**
   * Reads a coarse fix and asks for a set.
   *
   * `Accuracy.Low` is requested on purpose: the endpoint takes a coarse
   * position, snaps it to about a kilometre, and stores none of it
   * (`RouteSuggestionQuerySchema`). Asking the device for a precise fix would
   * collect something nothing needs.
   */
  const load = async (options: { targetDistanceKm?: number; targetMinutes?: number } = {}) => {
    const request = ++generation.current;
    setState('loading');
    setUnavailable(undefined);
    try {
      const granted = await Location.getForegroundPermissionsAsync();
      const current = getLocationPermissionState(granted);
      const resolved =
        current === 'granted'
          ? granted
          : current === 'idle'
            ? await Location.requestForegroundPermissionsAsync()
            : granted;
      const next = getLocationPermissionState(resolved);
      if (!mounted.current || request !== generation.current) return;
      setPermission(next);
      if (next !== 'granted') {
        setState('idle');
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const response = await api.suggestRoutes(
        { latitude: position.coords.latitude, longitude: position.coords.longitude },
        options
      );
      if (!mounted.current || request !== generation.current) return;

      const nextCards = routePreviewCards(response.data);
      setCards(nextCards);
      setSelected((previous) => clampSelectedIndex(nextCards.length, previous));
      setReason(targetReasonMessage(response));
      setNote(response.note);
      setTarget(response.targetDistanceMetres);
      const resolvedState = routePreviewStateFor(response);
      if (resolvedState === 'empty') setUnavailable(unavailableMessage(response));
      setState(resolvedState);
    } catch (error) {
      if (!mounted.current || request !== generation.current) return;
      const failure = routePreviewErrorStateFor(error);
      if (failure === 'session-expired') onSessionExpired();
      else setState(failure);
    }
  };

  useEffect(() => {
    void load();
    // A fresh client means a fresh session; the previous set is not this
    // account's to show.
  }, [api]);

  const card = cards[selected];
  const layers = useMemo(() => (card ? routePreviewLayers(card.suggestion) : []), [card]);
  const centre = useMemo(() => (card ? loopCentre(card.suggestion) : undefined), [card]);

  const step = (direction: 'up' | 'down') => {
    const from = target ?? MIN_TARGET_METRES;
    if (!canStepTarget(from, direction)) return;
    const next = stepTargetMetres(from, direction);
    setTarget(next);
    setMinutesText('');
    setMinutesError(undefined);
    void load({ targetDistanceKm: next / 1_000 });
  };

  const applyMinutes = () => {
    const parsed = parseMinutesInput(minutesText);
    if ('error' in parsed) {
      setMinutesError(parsed.error);
      return;
    }
    setMinutesError(undefined);
    void load({ targetMinutes: parsed.minutes });
  };

  const decline = async () => {
    if (!card) return;
    const routeId = card.suggestion.id;
    try {
      await api.sendRouteSuggestionFeedback(routeId, 'declined');
    } catch {
      // A decline that did not reach the server is not worth blocking on: the
      // worst outcome is being offered the same loop again.
    }
    await load(target ? { targetDistanceKm: target / 1_000 } : {});
  };

  const use = async () => {
    if (!card) return;
    const suggestion = card.suggestion;
    try {
      await api.sendRouteSuggestionFeedback(suggestion.id, 'accepted');
    } catch {
      // The run matters more than the telemetry.
    }
    onUseRoute(routeGuideFrom(suggestion));
  };

  // `FocusedScrollShell` owns the vertical scroll, so this is a plain view.
  // The carousel below scrolls horizontally, which does not nest.
  return (
    <View style={styles.flexCopy}>
      <BackHeader label="Route ideas" onBack={onBack} />

      {permission !== 'granted' && state !== 'loading' ? (
        <View style={styles.centeredState}>
          <Text style={styles.sectionTitle}>Route ideas need a rough location</Text>
          <Text style={styles.lead}>
            {permission === 'blocked'
              ? 'Location is turned off for RunSphere. Turn it on in Settings to see reviewed routes near you.'
              : 'RunSphere asks for an approximate location once, to find reviewed routes nearby. It is not stored.'}
          </Text>
          {permission !== 'blocked' && (
            <PrimaryButton label="Find routes near me" onPress={() => void load()} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start without a route"
            onPress={onStartWithout}
          >
            <Text style={styles.textButton}>Start without a route</Text>
          </Pressable>
        </View>
      ) : state === 'loading' ? (
        <View style={styles.loading}>
          <Text style={styles.muted}>Looking for reviewed routes near you…</Text>
        </View>
      ) : state === 'offline' || state === 'error' || state === 'configuration' ? (
        <View style={styles.centeredState}>
          <Text style={styles.sectionTitle}>Route ideas are unavailable</Text>
          <Text style={styles.lead}>
            {state === 'offline'
              ? 'RunSphere could not reach the service. Your run does not need it — start whenever you like.'
              : 'Route ideas could not be loaded. Your run does not need them.'}
          </Text>
          <PrimaryButton label="Try again" onPress={() => void load()} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start without a route"
            onPress={onStartWithout}
          >
            <Text style={styles.textButton}>Start without a route</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {card ? (
            <View style={styles.routePreviewMap} importantForAccessibility="no-hide-descendants">
              <MapSurface
                localLayers={layers}
                accessibilityLabel={`Preview of ${card.suggestion.name}, ${card.distanceLabel}.`}
                showAttribution={false}
                {...(centre ? { initialCenter: [centre[0], centre[1]] } : {})}
              />
            </View>
          ) : null}

          {/* A sentence, so it is set as one. `high_recent_load` in particular
              explains a deliberately shorter set, and shouting it in caps is a
              worse way to say something a runner might disagree with. */}
          {reason ? <Text style={styles.lead}>{reason}</Text> : null}
          {unavailable ? <Text style={styles.lead}>{unavailable}</Text> : null}

          {cards.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.routeCardRow}
            >
              {cards.map((entry, index) => (
                <Pressable
                  key={entry.suggestion.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === selected }}
                  accessibilityLabel={[
                    entry.sizeLabel,
                    entry.suggestion.name,
                    entry.distanceLabel,
                    entry.estimateLabel,
                    entry.startLabel,
                    ...entry.facts
                  ]
                    .filter(Boolean)
                    .join('. ')}
                  onPress={() => setSelected(index)}
                  style={[styles.routeCard, index === selected && styles.routeCardSelected]}
                >
                  {entry.sizeLabel ? <Text style={styles.badge}>{entry.sizeLabel}</Text> : null}
                  <Text style={styles.choiceTitle}>{entry.distanceLabel}</Text>
                  <Text style={styles.rowTitle}>{entry.suggestion.name}</Text>
                  {/* An estimate, never a target (`RouteSuggestionSchema`). */}
                  <Text style={styles.rowDetail}>{entry.estimateLabel}</Text>
                  <Text style={styles.rowDetail}>{entry.startLabel}</Text>
                  <View style={styles.routeFactRow}>
                    {entry.facts.map((fact) => (
                      <Text key={fact} style={styles.filterChip}>
                        {fact}
                      </Text>
                    ))}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <Text style={styles.fieldLabel}>DISTANCE</Text>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shorter"
              accessibilityState={{ disabled: !canStepTarget(target ?? MIN_TARGET_METRES, 'down') }}
              disabled={!canStepTarget(target ?? MIN_TARGET_METRES, 'down')}
              onPress={() => step('down')}
            >
              <Text style={styles.iconButton}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>
              {formatRouteDistance(target ?? MIN_TARGET_METRES)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Longer"
              accessibilityState={{ disabled: !canStepTarget(target ?? MIN_TARGET_METRES, 'up') }}
              disabled={!canStepTarget(target ?? MIN_TARGET_METRES, 'up')}
              onPress={() => step('up')}
            >
              <Text style={styles.iconButton}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.rowDetail}>
            {`Between ${formatRouteDistance(MIN_TARGET_METRES)} and ${formatRouteDistance(MAX_TARGET_METRES)}. Adjusting looks for a different reviewed loop, not a shortened one.`}
          </Text>

          <Text style={styles.fieldLabel}>OR HOW LONG YOU HAVE</Text>
          <TextInput
            style={styles.input}
            value={minutesText}
            onChangeText={(text) => {
              setMinutesText(text);
              setMinutesError(undefined);
            }}
            onSubmitEditing={applyMinutes}
            onBlur={() => minutesText.trim() && applyMinutes()}
            keyboardType="number-pad"
            returnKeyType="done"
            placeholder="Minutes"
            accessibilityLabel="How many minutes you have"
          />
          {minutesError ? <Text style={styles.errorText}>{minutesError}</Text> : null}

          {note ? <Text style={styles.privateNote}>{note}</Text> : null}

          {card ? (
            <>
              <PrimaryButton label="Use this route" onPress={() => void use()} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Not this one"
                onPress={() => void decline()}
              >
                <Text style={styles.textButton}>Not this one</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start without a route"
            onPress={onStartWithout}
          >
            <Text style={styles.textButton}>Start without a route</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
