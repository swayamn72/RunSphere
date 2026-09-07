import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent
} from '@maplibre/maplibre-react-native';
import type {
  TerritoryClaim,
  TerritoryClaimActivityItem,
  TerritoryClaimBounds,
  TerritoryClaimHistoryResponse,
  TerritoryClaimSummary,
  TerritoryCluster,
  TerritoryEvent,
  TerritoryLeaderboardResponse,
  TerritoryRecommendation
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { useAppTheme } from '../theme/theme';
import { resolveMapRenderPlan } from '../maps/map-config';
import { CrewMascot } from '../components/CrewMascot';
import { TerritoryDetailScreen } from './TerritoryDetailScreen';
import { GhostRaceSheet } from './GhostRaceSheet';
import type { GhostRun } from './ghost-race-model';
import { CLAIM_PUBLISHES_NOTICE, FIRST_CLAIM_PRIVACY_PROMPT } from '@runsphere/domain';
import {
  TIER_HINT,
  activeEvents,
  efficiencyLabel,
  eventFeatures,
  eventLine,
  leaderboardRows,
  TRUNCATED_NOTE,
  boundsFrom,
  captureCelebration,
  claimFeatures,
  claimMarkers,
  clusterMarkers,
  crewForAvatar,
  detailTierFor,
  formatLoopTime,
  historyLine,
  recommendationLine,
  showsClusters,
  statusLabel,
  summaryLine,
  takeoverLine,
  territoryFacts,
  worthRefetching,
  type CaptureCelebration
} from './territory-claim-model';

/**
 * Turf — the territory map (Phase 5, milestone 5.1; ADR-0011).
 *
 * A globe you can spin and zoom into, with the ground people hold drawn on it
 * and their avatars sitting in the middle of it, in the manner of the reference
 * design. Run a closed loop to claim ground; run somebody else's loop faster to
 * take it.
 *
 * **This screen names people.** That is the reversal ADR-0011 records, and the
 * note under the map says so in the app's own words rather than leaving somebody
 * to work out what a map of their neighbourhood with names on it is recording.
 */
export interface TurfScreenProps {
  readonly api: MobileApiClient;
  readonly onOpenRun?: () => void;
  /**
   * Leaves the tab to start a run with a ghost on the map. Optional, so a
   * caller that has nowhere to send the runner simply never shows the button.
   */
  readonly onGhostRace?: (run: GhostRun) => void;
  readonly onSessionExpired?: () => void;
}

/** Mumbai, so an empty first launch opens somewhere rather than at null island. */
const INITIAL_CENTRE: [number, number] = [72.8777, 19.076];
const INITIAL_ZOOM = 13;
/** The ring around a cluster that contains any of the reader's own ground. */
const SELF_RING = '#C9F15A';

export function TurfScreen({ api, onOpenRun, onGhostRace, onSessionExpired }: TurfScreenProps) {
  const { tokens, reduceMotion } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const renderPlan = useMemo(() => resolveMapRenderPlan(), []);
  const cameraRef = useRef<CameraRef>(null);

  const [claims, setClaims] = useState<readonly TerritoryClaim[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [summary, setSummary] = useState<TerritoryClaimSummary>();
  const [feed, setFeed] = useState<readonly TerritoryClaimActivityItem[]>([]);
  const [mapNote, setMapNote] = useState('');
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string>();
  const [claimableRunId, setClaimableRunId] = useState<string>();
  const [claiming, setClaiming] = useState(false);
  const [clusters, setClusters] = useState<readonly TerritoryCluster[]>([]);
  const [history, setHistory] = useState<TerritoryClaimHistoryResponse>();
  /**
   * The claim whose ghost is being confirmed.
   *
   * Only an id, not the claim: the sheet fetches the trace itself, and holding
   * a copy of the claim here would let the two drift apart if the map
   * refreshed underneath.
   */
  const [ghostClaimId, setGhostClaimId] = useState<string>();
  const [recommendations, setRecommendations] = useState<readonly TerritoryRecommendation[]>([]);
  const [recommendationNote, setRecommendationNote] = useState('');
  const [notEnoughRuns, setNotEnoughRuns] = useState(false);
  const [celebration, setCelebration] = useState<CaptureCelebration>();
  const [showDetail, setShowDetail] = useState(false);
  const [privacyPrompt, setPrivacyPrompt] = useState(false);
  const [events, setEvents] = useState<readonly TerritoryEvent[]>([]);
  const [board, setBoard] = useState<TerritoryLeaderboardResponse>();
  const lastBounds = useRef<TerritoryClaimBounds | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadClaims = useCallback(
    async (bounds: TerritoryClaimBounds) => {
      try {
        const response = await api.getTerritoryClaims(bounds);
        if (!mounted.current) return;
        setClaims(response.claims);
        setTruncated(response.truncated);
        setMapNote(response.mapNote);
      } catch {
        // A failed viewport fetch leaves the ground already drawn in place
        // rather than blanking the map: a map that empties on a dropped
        // request reads as "nobody holds anything here".
        if (mounted.current) setNotice('Could not refresh the map. Showing what was last loaded.');
      }
    },
    [api]
  );

  const loadMine = useCallback(async () => {
    try {
      const [mine, activity, runs, eventList, leaderboard] = await Promise.all([
        api.getTerritoryClaimSummary(),
        api.getTerritoryClaimActivity(),
        // Claiming is something a person does, not something that happens to
        // them: a run only reaches the map when they say so (ADR-0011).
        api.listActivities().catch(() => []),
        api.getTerritoryEvents().catch(() => ({ data: [] })),
        api.getTerritoryLeaderboard().catch(() => undefined)
      ]);
      if (!mounted.current) return;
      setSummary(mine);
      setFeed(activity.data);
      setEvents(eventList.data);
      if (leaderboard) setBoard(leaderboard);
      setClaimableRunId(runs.filter((run) => run.status === 'derived').at(0)?.id);
    } catch {
      // The map is the point of the screen; a failed sidebar must not take it
      // down with it.
    }
  }, [api]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const loadClusters = useCallback(
    async (bounds: TerritoryClaimBounds) => {
      try {
        const response = await api.getTerritoryClusters(bounds);
        if (mounted.current) setClusters(response.clusters);
      } catch {
        // Same rule as the claim layer: keep what is drawn rather than
        // blanking the world on a dropped request.
      }
    },
    [api]
  );

  const loadRecommendations = useCallback(
    async (bounds: TerritoryClaimBounds) => {
      try {
        const response = await api.getTerritoryRecommendations(bounds);
        if (!mounted.current) return;
        setRecommendations(response.data);
        setRecommendationNote(response.note);
        setNotEnoughRuns(response.unavailableReason === 'not_enough_runs');
      } catch {
        if (mounted.current) setRecommendations([]);
      }
    },
    [api]
  );

  const onRegionChanged = (event: { nativeEvent: ViewStateChangeEvent }) => {
    const { bounds, zoom: nextZoom } = event.nativeEvent;
    setZoom(nextZoom);
    const next = boundsFrom(bounds);
    if (!worthRefetching(lastBounds.current, next)) return;
    lastBounds.current = next;
    // Zoomed out, the map asks for activity blobs; zoomed in, for territories.
    // Asking for both at every zoom would ship a continent of polygons to draw
    // a dozen dots.
    if (showsClusters(detailTierFor(nextZoom))) {
      void loadClusters(next);
      return;
    }
    void loadClaims(next);
    void loadRecommendations(next);
  };

  const tier = detailTierFor(zoom);
  const clustered = showsClusters(tier);
  const features = useMemo(() => claimFeatures(clustered ? [] : claims), [claims, clustered]);
  const markers = useMemo(() => (clustered ? [] : claimMarkers(claims)), [claims, clustered]);
  const bubbles = useMemo(() => (clustered ? clusterMarkers(clusters) : []), [clusters, clustered]);
  const chosen = useMemo(() => claims.find((claim) => claim.id === selected), [claims, selected]);
  const live = useMemo(() => activeEvents(events, new Date()), [events]);
  const liveEventFeatures = useMemo(() => eventFeatures(live), [live]);
  const boardRows = useMemo(() => (board ? leaderboardRows(board) : []), [board]);

  // A territory's story is fetched only when somebody opens it. Loading it for
  // every claim on screen would be hundreds of requests to draw one card.
  useEffect(() => {
    if (!selected) {
      setHistory(undefined);
      return;
    }
    let current = true;
    void api
      .getTerritoryClaimHistory(selected)
      .then((next) => {
        if (current && mounted.current) setHistory(next);
      })
      .catch(() => {
        if (current && mounted.current) setHistory(undefined);
      });
    return () => {
      current = false;
    };
  }, [api, selected]);

  const zoomBy = (amount: number) => {
    const next = Math.min(18, Math.max(1, zoom + amount));
    setZoom(next);
    // `setStop` rather than `easeTo`: a zoom button must not also move the
    // camera somewhere, and the centre is whatever the reader had panned to.
    cameraRef.current?.setStop({ zoom: next, duration: reduceMotion ? 0 : 250 });
  };

  // A full page rather than a taller sheet: the story of a piece of ground is
  // the point of this screen, and it does not belong squeezed under a map.
  // The confirmation is a screen of its own rather than a sheet over the
  // detail page, because opening it spends one of three ghost views an hour —
  // that is a decision, and a decision should not look like a tooltip.
  if (ghostClaimId && chosen && onGhostRace)
    return (
      <View style={styles.root}>
        <GhostRaceSheet
          api={api}
          claimId={ghostClaimId}
          holderName={chosen.owner.displayName}
          onStart={(run) => {
            setGhostClaimId(undefined);
            onGhostRace(run);
          }}
          onCancel={() => setGhostClaimId(undefined)}
          onSessionExpired={onSessionExpired ?? (() => setGhostClaimId(undefined))}
        />
      </View>
    );

  if (showDetail && chosen)
    return (
      <TerritoryDetailScreen
        claim={chosen}
        history={history}
        onBack={() => setShowDetail(false)}
        {...(onGhostRace && !chosen.owner.isSelf
          ? { onGhostRace: () => setGhostClaimId(chosen.id) }
          : {})}
      />
    );

  return (
    <View style={styles.root}>
      <View style={styles.mapWrap}>
        {renderPlan.kind === 'provider' ? (
          <Map
            accessibilityLabel="Territory map. Areas people hold, with their names."
            style={StyleSheet.absoluteFill}
            mapStyle={renderPlan.provider.styleUrl}
            attribution={false}
            logo={false}
            compass={false}
            scaleBar={false}
            onRegionDidChange={onRegionChanged}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{ center: [...INITIAL_CENTRE], zoom: INITIAL_ZOOM }}
            />
            {/*
              Event areas are drawn first, so an event frames the ground rather
              than covering up who holds it.
            */}
            <GeoJSONSource id="turf-events" data={liveEventFeatures}>
              <Layer
                id="turf-events-fill"
                type="fill"
                paint={{ 'fill-color': SELF_RING, 'fill-opacity': 0.08 }}
              />
              <Layer
                id="turf-events-outline"
                type="line"
                paint={{ 'line-color': SELF_RING, 'line-width': 2, 'line-dasharray': [2, 2] }}
              />
            </GeoJSONSource>

            <GeoJSONSource id="turf-claims" data={features}>
              {/*
                Held ground is translucent so the streets underneath stay
                readable — the point is knowing *where* the ground is, and a
                solid block hides the roads somebody has to run.
              */}
              <Layer
                id="turf-claims-fill"
                type="fill"
                paint={{
                  'fill-color': ['get', 'colour'],
                  'fill-opacity': ['case', ['get', 'isSelf'], 0.55, 0.38]
                }}
              />
              <Layer
                id="turf-claims-outline"
                type="line"
                paint={{
                  'line-color': ['get', 'colour'],
                  'line-width': ['case', ['get', 'isSelf'], 3, 1.5],
                  'line-opacity': 0.9
                }}
              />
            </GeoJSONSource>

            {bubbles.map((bubble) => (
              <Marker key={bubble.key} id={bubble.key} lngLat={[...bubble.lngLat]}>
                <View
                  accessible
                  accessibilityLabel={bubble.accessibilityLabel}
                  style={[
                    styles.bubble,
                    {
                      width: bubble.size,
                      height: bubble.size,
                      borderRadius: bubble.size / 2,
                      borderColor: bubble.includesSelf ? SELF_RING : styles.bubble.borderColor
                    }
                  ]}
                >
                  <Text style={styles.bubbleText} allowFontScaling={false}>
                    {bubble.label}
                  </Text>
                </View>
              </Marker>
            ))}

            {markers.map((marker) => (
              <Marker key={marker.claimId} id={marker.claimId} lngLat={[...marker.lngLat]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={marker.accessibilityLabel}
                  onPress={() => setSelected(marker.claimId)}
                  style={[styles.pin, { borderColor: marker.colour }]}
                >
                  {/*
                    RunSphere has no uploaded profile photos — identity is a
                    cosmetic key — so a pin shows the crew mascot that key maps
                    to. Drawn locally, so no image host ever learns who is on
                    this map and the map issues no request of its own.
                  */}
                  <CrewMascot
                    character={crewForAvatar(marker.avatarKey)}
                    size={30}
                    accessibility={{ mode: 'decorative' }}
                  />
                </Pressable>
              </Marker>
            ))}
          </Map>
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackTitle}>The map is not configured</Text>
            <Text style={styles.body}>
              Territory still counts, and the list below is all of it. A map style has to be
              configured before ground can be drawn.
            </Text>
          </View>
        )}

        {renderPlan.kind === 'provider' && (
          <View style={styles.controls} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              onPress={() => zoomBy(1)}
              style={styles.control}
            >
              <Text style={styles.controlText} allowFontScaling={false}>
                +
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              onPress={() => zoomBy(-1)}
              style={styles.control}
            >
              <Text style={styles.controlText} allowFontScaling={false}>
                −
              </Text>
            </Pressable>
          </View>
        )}

        {TIER_HINT[tier] ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{TIER_HINT[tier]}</Text>
          </View>
        ) : null}
        {truncated && !clustered && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{TRUNCATED_NOTE}</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <Text accessibilityRole="header" style={styles.title}>
          Turf
        </Text>
        <Text style={styles.body}>{summaryLine(summary)}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {celebration ? (
          <View
            accessible
            accessibilityLabel={celebration.accessibilityLabel}
            accessibilityLiveRegion="polite"
            style={styles.celebration}
          >
            <Text style={styles.celebrationHeadline}>{celebration.headline}</Text>
            <Text style={styles.celebrationDetail}>{celebration.detail}</Text>
            {privacyPrompt ? (
              <Text style={styles.celebrationDetail}>{FIRST_CLAIM_PRIVACY_PROMPT}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss capture result"
              onPress={() => {
                setCelebration(undefined);
                setPrivacyPrompt(false);
              }}
            >
              <Text style={styles.link}>Done</Text>
            </Pressable>
          </View>
        ) : null}

        {chosen ? (
          <View style={[styles.card, { borderColor: styles.card.borderColor }]}>
            <Text style={styles.cardTitle}>
              {chosen.owner.isSelf ? 'Your ground' : `${chosen.owner.displayName}’s ground`}
            </Text>
            <Text style={styles.helper}>{statusLabel(chosen)}</Text>
            <Text style={styles.body}>{territoryFacts(chosen)}</Text>
            <Text style={styles.helper}>
              {chosen.owner.isSelf
                ? 'Somebody who runs this loop faster than you takes it.'
                : `Run this loop in under ${formatLoopTime(chosen.durationSeconds)} to take it.`}
            </Text>
            {history && history.entries.length > 1 ? (
              <>
                <Text style={styles.cardTitle}>Owner history</Text>
                {history.entries.map((entry) => (
                  <Text key={entry.claimId} style={styles.helper}>
                    {historyLine(entry)}
                  </Text>
                ))}
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the full history of this territory"
              onPress={() => setShowDetail(true)}
            >
              <Text style={styles.link}>Full history</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close claim details"
              onPress={() => setSelected(undefined)}
            >
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
        ) : null}

        {claimableRunId && (summary?.claimCount ?? 0) === 0 ? (
          <Text style={styles.helper}>{CLAIM_PUBLISHES_NOTICE}</Text>
        ) : null}
        {claimableRunId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Claim ground from your last run"
            disabled={claiming}
            onPress={() =>
              void (async () => {
                setClaiming(true);
                try {
                  const result = await api.claimTerritory(claimableRunId);
                  if (!mounted.current) return;
                  setNotice(result.message);
                  if (result.claimed) {
                    setCelebration(captureCelebration(result.claim, result.takenOverCount));
                    // Said once, the moment it becomes true, rather than
                    // inferred from where somebody lives.
                    if (result.isFirstClaim) setPrivacyPrompt(true);
                    await loadMine();
                    if (lastBounds.current) await loadClaims(lastBounds.current);
                  }
                } catch {
                  if (mounted.current) setNotice('That claim could not be made. Try again.');
                } finally {
                  if (mounted.current) setClaiming(false);
                }
              })()
            }
            style={styles.primary}
          >
            <Text style={styles.primaryText}>
              {claiming ? 'Claiming…' : 'Claim ground from your last run'}
            </Text>
          </Pressable>
        ) : null}

        {onOpenRun ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a run"
            onPress={onOpenRun}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Start a run</Text>
          </Pressable>
        ) : null}

        {!clustered ? (
          <>
            <Text accessibilityRole="header" style={styles.subtitle}>
              Within reach
            </Text>
            {notEnoughRuns ? (
              <Text style={styles.helper}>
                Run a few more times and RunSphere can estimate which territories are within reach.
              </Text>
            ) : recommendations.length === 0 ? (
              <Text style={styles.helper}>
                Nothing nearby looks within reach right now. Pan the map to look elsewhere.
              </Text>
            ) : (
              <>
                {recommendations.map((recommendation) => (
                  <Pressable
                    key={recommendation.claim.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${recommendation.claim.owner.displayName}'s territory. ${recommendation.reason}`}
                    onPress={() => setSelected(recommendation.claim.id)}
                  >
                    <Text style={styles.body}>{recommendationLine(recommendation)}</Text>
                    <Text style={styles.helper}>{efficiencyLabel(recommendation.efficiency)}</Text>
                  </Pressable>
                ))}
                {/*
                  The estimate never appears without this: it is a guess from
                  somebody's own recent runs, and it does not know the road.
                */}
                <Text style={styles.helper}>{recommendationNote}</Text>
              </>
            )}
          </>
        ) : null}

        {live.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.subtitle}>
              Events
            </Text>
            {live.map((event) => (
              <View
                key={event.id}
                accessible
                accessibilityLabel={`${eventLine(event, new Date())}. ${event.reward}.`}
              >
                <Text style={styles.body}>{eventLine(event, new Date())}</Text>
                <Text style={styles.helper}>{`${event.description} Reward: ${event.reward}.`}</Text>
              </View>
            ))}
          </>
        ) : null}

        {boardRows.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.subtitle}>
              Most ground held
            </Text>
            {boardRows.map((row) => (
              <View
                accessible
                accessibilityLabel={row.accessibilityLabel}
                key={row.key}
                style={[styles.row, row.isSelf && styles.rowSelf]}
              >
                <Text style={styles.rank}>{row.rankLabel}</Text>
                <Text style={styles.body}>{row.name}</Text>
                <Text style={styles.helper}>{row.detail}</Text>
              </View>
            ))}
            {board ? <Text style={styles.helper}>{board.note}</Text> : null}
          </>
        ) : null}

        <Text accessibilityRole="header" style={styles.subtitle}>
          Recent takeovers
        </Text>
        {feed.length === 0 ? (
          <Text style={styles.helper}>
            Nothing has changed hands yet. Ground you claim shows here when somebody takes it.
          </Text>
        ) : (
          feed.map((item) => (
            <Text key={item.id} style={styles.feedLine}>
              {takeoverLine(item)}
            </Text>
          ))
        )}

        {/*
          Said under the map, not behind a link: this is the one surface that
          shows real people's names against real streets.
        */}
        {mapNote ? <Text style={styles.helper}>{mapNote}</Text> : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    mapWrap: { backgroundColor: tokens.background.surfaceInset, flex: 1, minHeight: 260 },
    fallback: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
    fallbackTitle: {
      color: tokens.text.primary,
      fontSize: 18,
      fontWeight: '800',
      marginBottom: 6,
      textAlign: 'center'
    },
    pin: {
      alignItems: 'center',
      backgroundColor: tokens.background.surface,
      borderRadius: 20,
      borderWidth: 3,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    pinGlyph: { color: tokens.text.primary, fontSize: 16, fontWeight: '900' },
    bubble: {
      alignItems: 'center',
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.strong,
      borderWidth: 3,
      justifyContent: 'center'
    },
    bubbleText: { color: tokens.text.primary, fontSize: 14, fontWeight: '900' },
    celebration: {
      backgroundColor: tokens.background.surfaceInset,
      borderColor: SELF_RING,
      borderRadius: 16,
      borderWidth: 2,
      gap: 4,
      padding: 14
    },
    row: {
      alignItems: 'center',
      borderTopColor: tokens.border.subtle,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 10,
      paddingVertical: 6
    },
    rowSelf: { backgroundColor: tokens.background.surfaceInset },
    rank: { color: tokens.text.primary, fontSize: 14, fontWeight: '800', minWidth: 34 },
    celebrationHeadline: { color: tokens.text.primary, fontSize: 18, fontWeight: '900' },
    celebrationDetail: { color: tokens.text.primary, fontSize: 14, lineHeight: 20 },
    controls: { gap: 8, position: 'absolute', right: 12, top: 12 },
    control: {
      alignItems: 'center',
      backgroundColor: tokens.map.control,
      borderColor: tokens.border.subtle,
      borderRadius: 24,
      borderWidth: 1,
      height: 48,
      justifyContent: 'center',
      width: 48
    },
    controlText: { color: tokens.map.controlText, fontSize: 20, fontWeight: '900' },
    banner: {
      backgroundColor: tokens.map.scrim,
      borderRadius: 12,
      bottom: 12,
      left: 12,
      padding: 10,
      position: 'absolute',
      right: 12
    },
    bannerText: { color: tokens.map.controlText, fontSize: 13, fontWeight: '700' },
    sheet: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderTopWidth: 1,
      maxHeight: '46%'
    },
    sheetContent: { gap: 8, padding: 16, paddingBottom: 96 },
    title: { color: tokens.text.primary, fontSize: 20, fontWeight: '900' },
    subtitle: { color: tokens.text.primary, fontSize: 15, fontWeight: '800', marginTop: 8 },
    body: { color: tokens.text.primary, fontSize: 14, lineHeight: 20 },
    helper: { color: tokens.text.secondary, fontSize: 13, lineHeight: 18 },
    notice: { color: tokens.text.secondary, fontSize: 13, lineHeight: 18 },
    feedLine: { color: tokens.text.primary, fontSize: 14, lineHeight: 20 },
    link: { color: tokens.text.secondary, fontSize: 13, fontWeight: '800', marginTop: 6 },
    card: {
      backgroundColor: tokens.background.surfaceInset,
      borderColor: tokens.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      gap: 4,
      padding: 12
    },
    cardTitle: { color: tokens.text.primary, fontSize: 15, fontWeight: '800' },
    primary: {
      alignItems: 'center',
      backgroundColor: tokens.action.primary,
      borderRadius: 16,
      justifyContent: 'center',
      minHeight: 48,
      marginTop: 4
    },
    primaryText: { color: tokens.text.onAccent, fontSize: 15, fontWeight: '800' }
  });
