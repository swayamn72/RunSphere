import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type MapRef,
  type StyleSpecification,
  type ViewStateChangeEvent
} from '@maplibre/maplibre-react-native';
import type {
  Profile,
  ProgressionSummary,
  QuestDetail,
  QuestSummary,
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
import { turfWorldStyle } from '../maps/turf-world-style';
import { useTurfPosition } from '../maps/use-turf-position';
import { useTurfExploration } from '../maps/use-turf-exploration';
import { fogFeatures } from '../maps/turf-exploration';
import { CrewMascot } from '../components/CrewMascot';
import { TerritoryDetailScreen } from './TerritoryDetailScreen';
import { GhostRaceSheet } from './GhostRaceSheet';
import { seasonDaysLeft } from './home-progression-model';
import { selectedCheckpointLayers } from './explore-model';
import {
  dashboardPreviewEnabled,
  previewClaimHistory,
  previewClaims,
  previewGhostTrace,
  previewTurfQuests
} from './dashboard-preview';
import { ghostOffer, type GhostRun } from './ghost-race-model';
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
  TURF_LEGEND,
  captureCelebration,
  claimableRunId as pickClaimableRun,
  claimFeatures,
  claimGridFeatures,
  CONTESTED_COLOUR,
  claimMarkers,
  clusterMarkers,
  crewForAvatar,
  detailTierFor,
  recommendationLine,
  showsClusters,
  statusLabel,
  summaryLine,
  takeoverLine,
  targetPaceLabel,
  worthRefetching,
  SELF_COLOUR,
  ZONE_FILTERS,
  filterClaims,
  zoneFilterSummary,
  type CaptureCelebration,
  type ZoneFilter
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
  readonly accountId?: string;
  readonly onOpenRun?: () => void;
  readonly onOpenQuest?: (quest: QuestSummary) => void;
  readonly onOpenProfile?: () => void;
  readonly onOpenSettings?: () => void;
  /**
   * Leaves the tab to start a run with a ghost on the map. Optional, so a
   * caller that has nowhere to send the runner simply never shows the button.
   */
  readonly onGhostRace?: (run: GhostRun) => void;
  readonly onSessionExpired?: () => void;
}

/** Mumbai, so an empty first launch opens somewhere rather than at null island. */
const INITIAL_CENTRE: [number, number] = [72.8777, 19.076];
const INITIAL_ZOOM = 14.5;
const INITIAL_PITCH = 52;
/** The ring around a cluster that contains any of the reader's own ground. */
const SELF_RING = SELF_COLOUR;

export function TurfScreen({
  api,
  accountId,
  onOpenRun,
  onOpenQuest,
  onOpenProfile,
  onOpenSettings,
  onGhostRace,
  onSessionExpired
}: TurfScreenProps) {
  const { tokens, reduceMotion } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const renderPlan = useMemo(() => resolveMapRenderPlan(), []);
  const providerUrl = renderPlan.kind === 'provider' ? renderPlan.provider.styleUrl : undefined;
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [worldStyle, setWorldStyle] = useState<StyleSpecification>();
  const [following, setFollowing] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapInfoOpen, setMapInfoOpen] = useState(false);
  const [questPins, setQuestPins] = useState<readonly QuestSummary[]>([]);
  const [selectedQuest, setSelectedQuest] = useState<QuestSummary>();
  const [questDetail, setQuestDetail] = useState<QuestDetail>();
  const [questUnavailable, setQuestUnavailable] = useState(false);
  const [viewport, setViewport] = useState<TerritoryClaimBounds>();
  const visited = useTurfExploration(accountId, dashboardPreviewEnabled);
  const [profile, setProfile] = useState<Profile>();
  const [progression, setProgression] = useState<ProgressionSummary>();
  const [pulseBright, setPulseBright] = useState(true);

  const [claims, setClaims] = useState<readonly TerritoryClaim[]>(
    dashboardPreviewEnabled ? previewClaims : []
  );
  const [truncated, setTruncated] = useState(false);
  const [summary, setSummary] = useState<TerritoryClaimSummary | undefined>(
    dashboardPreviewEnabled ? { claimCount: 7, totalAreaSqm: 84_000, lostCount: 1 } : undefined
  );
  const [feed, setFeed] = useState<readonly TerritoryClaimActivityItem[]>([]);
  const [mapNote, setMapNote] = useState(
    dashboardPreviewEnabled
      ? 'Sample territories'
      : 'Territory shows the loops people ran and the holder’s name.'
  );
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string>();
  /** The zone bar: which ground is drawn, and the name being looked for. */
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');
  const [search, setSearch] = useState('');
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
  const { position, requestPosition } = useTurfPosition(
    Boolean(providerUrl) && !showDetail && !ghostClaimId,
    dashboardPreviewEnabled
  );
  const lastBounds = useRef<TerritoryClaimBounds | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    if (!providerUrl) return;
    const controller = new AbortController();
    void fetch(providerUrl, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((style: StyleSpecification | undefined) => {
        if (style && !controller.signal.aborted) setWorldStyle(turfWorldStyle(style));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [providerUrl]);

  useEffect(() => {
    if (!following || !position || showDetail || ghostClaimId) return;
    cameraRef.current?.setStop({
      center: position.center,
      bearing: position.bearing,
      duration: reduceMotion ? 0 : 450
    });
  }, [following, ghostClaimId, position, reduceMotion, showDetail]);

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearchOpen(false);
  }, []);

  useEffect(() => {
    if (!searchOpen && !mapInfoOpen && !selected && !selectedQuest && !filtersOpen) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchOpen) closeSearch();
      else if (mapInfoOpen) setMapInfoOpen(false);
      else if (filtersOpen) setFiltersOpen(false);
      else if (ghostClaimId) setGhostClaimId(undefined);
      else if (showDetail) setShowDetail(false);
      else if (selected) setSelected(undefined);
      else if (selectedQuest) setSelectedQuest(undefined);
      else return false;
      return true;
    });
    return () => listener.remove();
  }, [
    closeSearch,
    filtersOpen,
    ghostClaimId,
    mapInfoOpen,
    searchOpen,
    selected,
    selectedQuest,
    showDetail
  ]);

  useEffect(() => {
    if (dashboardPreviewEnabled) return;
    let active = true;
    void Promise.resolve()
      .then(() => api.getProfile())
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => undefined);
    void Promise.resolve()
      .then(() => api.getProgressionSummary())
      .then((value) => {
        if (active) setProgression(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (dashboardPreviewEnabled) return;
    let active = true;
    void Promise.resolve()
      .then(() => api.listQuests())
      .then((value) => {
        if (active) setQuestPins(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    setQuestDetail(undefined);
    setQuestUnavailable(false);
    if (!selectedQuest) return;
    if (dashboardPreviewEnabled) {
      setQuestDetail(previewTurfQuests.find((quest) => quest.id === selectedQuest.id));
      return;
    }
    let active = true;
    void api
      .getQuest(selectedQuest.id)
      .then((detail) => {
        if (active) setQuestDetail(detail);
      })
      .catch(() => {
        if (active) setQuestUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [api, selectedQuest]);

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
      setClaimableRunId(pickClaimableRun(runs));
    } catch {
      // The map is the point of the screen; a failed sidebar must not take it
      // down with it.
    }
  }, [api]);

  useEffect(() => {
    if (!dashboardPreviewEnabled) void loadMine();
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
    setBearing(event.nativeEvent.bearing ?? 0);
    if (dashboardPreviewEnabled) return;
    const next = boundsFrom(bounds);
    if (!worthRefetching(lastBounds.current, next)) return;
    lastBounds.current = next;
    setViewport(next);
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
  const clustered = !dashboardPreviewEnabled && showsClusters(tier);
  /**
   * The bar narrows what is drawn, not what was loaded: the summary line below
   * still counts everything in the viewport, so a filter that hides every zone
   * reads as a filter rather than as empty ground.
   */
  const visibleClaims = useMemo(
    () => filterClaims(claims, zoneFilter, search),
    [claims, zoneFilter, search]
  );
  const features = useMemo(
    () => claimFeatures(clustered ? [] : visibleClaims),
    [visibleClaims, clustered]
  );
  const fog = useMemo(
    () => fogFeatures(clustered ? undefined : viewport, visited),
    [clustered, viewport, visited]
  );
  const questLayers = useMemo(
    () => selectedCheckpointLayers(questDetail?.id === selectedQuest?.id ? questDetail : undefined),
    [questDetail, selectedQuest]
  );
  const showGrid = !clustered && (dashboardPreviewEnabled || zoom >= 15.5);
  const gridFeatures = useMemo(
    () => claimGridFeatures(showGrid ? visibleClaims : []),
    [showGrid, visibleClaims]
  );
  const hasPulse =
    !clustered &&
    visibleClaims.some((claim) => claim.status === 'contested' || claim.revengeAvailable);
  useEffect(() => {
    if (!hasPulse || reduceMotion || showDetail || ghostClaimId) return;
    const timer = setInterval(() => setPulseBright((bright) => !bright), 1050);
    return () => clearInterval(timer);
  }, [ghostClaimId, hasPulse, reduceMotion, showDetail]);
  const markers = useMemo(
    () => (clustered ? [] : claimMarkers(visibleClaims)),
    [visibleClaims, clustered]
  );
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
    if (dashboardPreviewEnabled) {
      const claim = previewClaims.find((entry) => entry.id === selected);
      setHistory(claim ? previewClaimHistory(claim) : undefined);
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

  const recenter = async () => {
    setFollowing(true);
    setNotice('');
    try {
      if (position || (await requestPosition())) return;
    } catch {
      // Browsing remains available when location services cannot start.
    }
    setFollowing(false);
    setNotice('Turn on location access to see yourself on the map.');
  };

  // A full page rather than a taller sheet: the story of a piece of ground is
  // the point of this screen, and it does not belong squeezed under a map.
  // The confirmation is a screen of its own rather than a sheet over the
  // detail page, because opening it spends one of three ghost views an hour —
  // that is a decision, and a decision should not look like a tooltip.
  if (ghostClaimId && chosen && onGhostRace)
    return (
      <View style={[styles.root, styles.detailFrame]}>
        <GhostRaceSheet
          api={api}
          claimId={ghostClaimId}
          holderName={chosen.owner.displayName}
          {...(dashboardPreviewEnabled && chosen.id === previewGhostTrace.claimId
            ? { previewTrace: previewGhostTrace }
            : {})}
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
      <View style={[styles.root, styles.detailFrame]}>
        <TerritoryDetailScreen
          claim={chosen}
          history={history}
          onBack={() => setShowDetail(false)}
          {...(onGhostRace && ghostOffer(chosen, summary?.ghostRacesLeft).kind === 'available'
            ? { onGhostRace: () => setGhostClaimId(chosen.id) }
            : {})}
          {...(onOpenRun ? { onRunHere: onOpenRun } : {})}
        />
      </View>
    );

  const level = dashboardPreviewEnabled ? 4 : progression?.level?.level;
  const xp = dashboardPreviewEnabled ? 1240 : progression?.totalXp;
  const xpInLevel = dashboardPreviewEnabled ? 90 : progression?.level?.xpInLevel;
  const nextLevelAt = dashboardPreviewEnabled ? 1400 : progression?.level?.nextLevelAt;
  const xpPercent =
    xp !== undefined &&
    xpInLevel !== undefined &&
    nextLevelAt !== undefined &&
    nextLevelAt > xp - xpInLevel
      ? Math.max(0, Math.min(100, Math.round((100 * xpInLevel) / (nextLevelAt - xp + xpInLevel))))
      : undefined;
  const activeDays = dashboardPreviewEnabled ? 3 : progression?.weeklyConsistency?.activeDays;
  const playerName = dashboardPreviewEnabled ? 'Maya Chen' : (profile?.displayName ?? 'Runner');
  const avatarKey = dashboardPreviewEnabled ? 'loop-1' : profile?.cosmetic?.avatarKey;
  const ghost = chosen && onGhostRace ? ghostOffer(chosen, summary?.ghostRacesLeft) : undefined;
  const selectClaim = (id: string) => {
    setMapInfoOpen(false);
    setSelectedQuest(undefined);
    setSelected(id);
  };

  return (
    <View style={styles.root}>
      <View style={styles.mapWrap}>
        {renderPlan.kind === 'provider' ? (
          <Map
            ref={mapRef}
            accessibilityLabel="Territory map. Areas people hold, with their names."
            style={StyleSheet.absoluteFill}
            mapStyle={worldStyle ?? renderPlan.provider.styleUrl}
            attribution={false}
            logo={false}
            compass={false}
            scaleBar={false}
            onPress={({ nativeEvent }) => {
              void mapRef.current
                ?.queryRenderedFeatures(nativeEvent.point, { layers: ['turf-claims-fill'] })
                .then((hits) => {
                  const id = hits[0]?.properties?.claimId;
                  if (mounted.current && typeof id === 'string') selectClaim(id);
                })
                .catch(() => undefined);
            }}
            onDidFailLoadingMap={() => {
              if (worldStyle) setWorldStyle(undefined);
            }}
            onRegionWillChange={(event) => {
              if (event.nativeEvent.userInteraction) setFollowing(false);
            }}
            onRegionDidChange={onRegionChanged}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{
                center: INITIAL_CENTRE,
                zoom: INITIAL_ZOOM,
                pitch: INITIAL_PITCH
              }}
            />
            {fog.features.length > 0 && (
              <GeoJSONSource id="turf-private-fog" data={fog}>
                <Layer
                  id="turf-private-fog-fill"
                  type="fill"
                  paint={{ 'fill-color': '#040917', 'fill-opacity': 0.32, 'fill-antialias': false }}
                />
              </GeoJSONSource>
            )}
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

            <GeoJSONSource
              id="turf-claims"
              data={features}
              onPress={(event) => {
                const id = event.nativeEvent.features[0]?.properties?.claimId;
                if (typeof id !== 'string') return;
                event.stopPropagation();
                selectClaim(id);
              }}
            >
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
                  'fill-opacity': ['case', ['get', 'isSelf'], 0.23, 0.17]
                }}
              />
              <Layer
                id="turf-claims-glow"
                type="line"
                paint={{
                  'line-color': ['get', 'colour'],
                  'line-width': 11,
                  'line-blur': 6,
                  'line-opacity': 0.7
                }}
              />
              <Layer
                id="turf-claims-outline"
                type="line"
                paint={{
                  'line-color': ['get', 'colour'],
                  'line-width': 2.5,
                  'line-opacity': 0.9
                }}
              />
              <Layer
                id="turf-contested-pulse"
                type="line"
                filter={['==', ['get', 'colour'], CONTESTED_COLOUR]}
                paint={{
                  'line-color': CONTESTED_COLOUR,
                  'line-width': 5,
                  'line-blur': 2,
                  'line-opacity': reduceMotion || pulseBright ? 0.95 : 0.25,
                  'line-opacity-transition': { duration: 900, delay: 0 }
                }}
              />
            </GeoJSONSource>
            {showGrid && (
              <GeoJSONSource id="turf-held-grid" data={gridFeatures}>
                <Layer
                  id="turf-held-grid-lines"
                  type="line"
                  paint={{
                    'line-color': ['get', 'colour'],
                    'line-opacity': 0.26,
                    'line-width': 0.75
                  }}
                />
              </GeoJSONSource>
            )}

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
              <Marker
                key={marker.claimId}
                id={marker.claimId}
                lngLat={[...marker.lngLat]}
                onPress={() => selectClaim(marker.claimId)}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[
                    marker.accessibilityLabel,
                    marker.crowned && 'Held for at least seven days.',
                    marker.defendedCount > 0 && `${marker.defendedCount} successful defenses.`,
                    marker.revenge && 'Revenge available. This rival took your turf.'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPress={() => selectClaim(marker.claimId)}
                  style={styles.pinAnchor}
                >
                  {/*
                    RunSphere has no uploaded profile photos — identity is a
                    cosmetic key — so a pin shows the crew mascot that key maps
                    to. Drawn locally, so no image host ever learns who is on
                    this map and the map issues no request of its own.
                  */}
                  {marker.revenge && !marker.revengeLocation && (
                    <View
                      style={[
                        styles.revengeBadge,
                        !reduceMotion && !pulseBright && styles.revengeDim
                      ]}
                    >
                      <Text style={styles.badgeText}>⚔ REVENGE</Text>
                    </View>
                  )}
                  <View style={[styles.pin, { borderColor: marker.colour }]}>
                    <CrewMascot
                      character={crewForAvatar(marker.avatarKey)}
                      size={28}
                      accessibility={{ mode: 'decorative' }}
                    />
                  </View>
                  <View style={[styles.pinStem, { backgroundColor: marker.colour }]} />
                  {marker.crowned && <Text style={styles.crownBadge}>♛</Text>}
                  {marker.defendedCount > 0 && (
                    <View style={styles.defenseBadge}>
                      <Text style={styles.badgeText}>🛡 {marker.defendedCount}</Text>
                    </View>
                  )}
                </Pressable>
              </Marker>
            ))}
            {markers.map(
              (marker) =>
                marker.revengeLocation && (
                  <Marker
                    key={`${marker.claimId}-revenge`}
                    id={`${marker.claimId}-revenge`}
                    lngLat={marker.revengeLocation}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Revenge against ${marker.displayName}`}
                      onPress={() => selectClaim(marker.claimId)}
                      style={[
                        styles.revengeBadge,
                        styles.revengeBeacon,
                        !reduceMotion && !pulseBright && styles.revengeDim
                      ]}
                    >
                      <Text style={styles.badgeText}>⚔ REVENGE</Text>
                    </Pressable>
                  </Marker>
                )
            )}
            {questLayers.map((layer) => (
              <GeoJSONSource key={layer.id} id={`turf-${layer.id}`} data={layer.data}>
                {layer.kind === 'circle' ? (
                  <Layer
                    id={`turf-${layer.id}-points`}
                    type="circle"
                    paint={{
                      'circle-color': '#ffe38c',
                      'circle-radius': 5,
                      'circle-stroke-color': '#362717',
                      'circle-stroke-width': 2
                    }}
                  />
                ) : (
                  <Layer
                    id={`turf-${layer.id}-trail`}
                    type="line"
                    paint={{ 'line-color': '#ffe38c', 'line-width': 4, 'line-dasharray': [1, 1.8] }}
                  />
                )}
              </GeoJSONSource>
            ))}
            {!clustered &&
              (dashboardPreviewEnabled ? previewTurfQuests : questPins).map((quest) => {
                if (!quest.mapPosition || quest.openHours.status === 'closed') return null;
                const select = () => {
                  setSelected(undefined);
                  setMapInfoOpen(false);
                  setSelectedQuest(quest);
                };
                return (
                  <Marker
                    key={quest.id}
                    id={`quest-${quest.id}`}
                    lngLat={quest.mapPosition}
                    onPress={select}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Quest: ${quest.title}`}
                      onPress={select}
                      style={styles.questBeacon}
                    >
                      <View style={styles.questBeaconCore}>
                        <Text style={styles.questGlyph}>✦</Text>
                      </View>
                    </Pressable>
                  </Marker>
                );
              })}
            {position && (
              <Marker id="turf-player" lngLat={position.center}>
                <PlayerBeacon
                  bearing={position.bearing - bearing}
                  reduceMotion={reduceMotion}
                  styles={styles}
                />
              </Marker>
            )}
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

        {/*
          The zone bar sits over the map rather than above it: the map is the
          screen, and a bar in the layout would push the ground off it.
        */}
        <View style={styles.zoneBar} pointerEvents="box-none">
          <View style={styles.hudHeader} pointerEvents="box-none">
            <Pressable
              style={styles.playerPill}
              disabled={!onOpenProfile}
              accessibilityRole={onOpenProfile ? 'button' : 'text'}
              accessibilityLabel={`${playerName}${level === undefined ? '' : `, level ${level}`}${xp === undefined ? '' : `, ${xp} experience points`}${activeDays === undefined ? '' : `, ${activeDays} active days this week`}`}
              onPress={onOpenProfile}
            >
              <View style={styles.avatarRing}>
                <CrewMascot
                  character={crewForAvatar(avatarKey ?? 'default')}
                  size={26}
                  accessibility={{ mode: 'decorative' }}
                />
              </View>
              <View style={styles.playerCopy}>
                <Text numberOfLines={1} style={styles.hudLabel}>
                  {playerName}
                </Text>
                {level !== undefined && (
                  <Text style={styles.hudDetail}>
                    LVL {level}
                    {xp === undefined ? '' : ` · ${xp.toLocaleString()} XP`}
                  </Text>
                )}
                {activeDays !== undefined && (
                  <Text style={styles.hudDetail}>
                    🔥 {activeDays} active {activeDays === 1 ? 'day' : 'days'} this week
                  </Text>
                )}
                {xpPercent !== undefined && (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Progress to next level"
                    accessibilityValue={{ min: 0, max: 100, now: xpPercent }}
                    style={styles.xpTrack}
                  >
                    <View style={[styles.xpFill, { width: `${xpPercent}%` }]} />
                  </View>
                )}
              </View>
            </Pressable>
            <View
              style={styles.seasonPill}
              accessible
              accessibilityLabel={`Season resets in ${seasonDaysLeft(new Date())} days`}
            >
              <Text style={styles.hudDetail}>SEASON</Text>
              <Text style={styles.hudLabel}>{seasonDaysLeft(new Date())}d left</Text>
            </View>
          </View>
          <View style={styles.tools}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? 'Close zone search' : 'Open zone search'}
              accessibilityState={{ expanded: searchOpen }}
              onPress={searchOpen ? closeSearch : () => setSearchOpen(true)}
              style={[styles.control, search !== '' && styles.controlActive]}
            >
              <Text style={styles.controlText}>{searchOpen ? '×' : '⌕'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Territory filters"
              accessibilityState={{ expanded: filtersOpen }}
              onPress={() => setFiltersOpen((open) => !open)}
              style={[
                styles.control,
                (filtersOpen || zoneFilter !== 'all') && styles.controlActive
              ]}
            >
              <Text style={styles.toolText}>☷</Text>
            </Pressable>
            {providerUrl && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Center on my location"
                accessibilityState={{ selected: following }}
                onPress={() => void recenter()}
                style={[styles.control, following && styles.controlActive]}
              >
                <Text style={styles.controlText}>◎</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open map intel"
              accessibilityState={{ expanded: mapInfoOpen }}
              onPress={() => setMapInfoOpen((open) => !open)}
              style={styles.control}
            >
              <Text style={styles.toolText}>ⓘ</Text>
            </Pressable>
            {onOpenSettings && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Turf settings"
                onPress={onOpenSettings}
                style={styles.control}
              >
                <Text style={styles.toolText}>⚙</Text>
              </Pressable>
            )}
          </View>
          {searchOpen && (
            <View style={styles.searchField}>
              <Text style={styles.searchGlyph} allowFontScaling={false}>
                ⌕
              </Text>
              <TextInput
                accessibilityLabel="Search zones by holder or city"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearch}
                onSubmitEditing={closeSearch}
                placeholder="Find a holder or city"
                placeholderTextColor={tokens.text.secondary}
                returnKeyType="search"
                style={styles.searchInput}
                value={search}
              />
              {search !== '' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear the zone search"
                  onPress={() => setSearch('')}
                >
                  <Text style={styles.searchGlyph}>×</Text>
                </Pressable>
              )}
            </View>
          )}
          {filtersOpen && (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {ZONE_FILTERS.map((entry) => {
                const active = zoneFilter === entry.key;
                return (
                  <Pressable
                    key={entry.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={entry.label}
                    onPress={() => setZoneFilter(entry.key)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {(filtersOpen || zoneFilter !== 'all' || search !== '') && (
            <Text style={styles.filterStatus}>
              {zoneFilterSummary(zoneFilter, visibleClaims.length, claims.length, search)}
            </Text>
          )}
        </View>

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

      {mapInfoOpen ? (
        <View style={[styles.sheet, styles.infoSheet]}>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            <View style={styles.cardHeader}>
              <Text accessibilityRole="header" style={styles.title}>
                Map intel
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close map intel"
                onPress={() => setMapInfoOpen(false)}
                style={styles.smallButton}
              >
                <Text style={styles.toolText}>×</Text>
              </Pressable>
            </View>
            {/* What the bar is showing, above what this account holds overall, so a
            narrowed map is never mistaken for unclaimed ground. */}
            <Text style={styles.body}>
              {zoneFilterSummary(zoneFilter, visibleClaims.length, claims.length, search)}
            </Text>
            <Text style={styles.helper}>{summaryLine(summary)}</Text>
            <View
              accessible
              accessibilityLabel={`Map colours: ${TURF_LEGEND.map((entry) => entry.label).join(', ')}`}
              style={styles.legend}
            >
              {TURF_LEGEND.map((entry) => (
                <View key={entry.label} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: entry.colour }]} />
                  <Text style={styles.helper}>{entry.label}</Text>
                </View>
              ))}
            </View>
            {!clustered ? (
              <>
                <Text accessibilityRole="header" style={styles.subtitle}>
                  Within reach
                </Text>
                {notEnoughRuns ? (
                  <Text style={styles.helper}>
                    Run a few more times and RunSphere can estimate which territories are within
                    reach.
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
                        onPress={() => selectClaim(recommendation.claim.id)}
                      >
                        <Text style={styles.body}>{recommendationLine(recommendation)}</Text>
                        <Text style={styles.helper}>
                          {efficiencyLabel(recommendation.efficiency)}
                        </Text>
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
                    <Text
                      style={styles.helper}
                    >{`${event.description} Reward: ${event.reward}.`}</Text>
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
      ) : chosen || selectedQuest || claimableRunId || notice || celebration ? (
        <View style={styles.sheet}>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {notice && !celebration ? (
              <View style={styles.cardHeader}>
                <Text style={[styles.notice, styles.playerCopy]} accessibilityLiveRegion="polite">
                  {notice}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss map notice"
                  onPress={() => setNotice('')}
                  style={styles.smallButton}
                >
                  <Text style={styles.toolText}>×</Text>
                </Pressable>
              </View>
            ) : null}

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
                    setNotice('');
                  }}
                >
                  <Text style={styles.link}>Done</Text>
                </Pressable>
              </View>
            ) : null}

            {selectedQuest && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.playerCopy}>
                    <Text style={styles.questAccent}>QUEST</Text>
                    <Text accessibilityRole="header" style={styles.title}>
                      {selectedQuest.title}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close quest preview"
                    onPress={() => setSelectedQuest(undefined)}
                    style={styles.smallButton}
                  >
                    <Text style={styles.toolText}>×</Text>
                  </Pressable>
                </View>
                <Text style={styles.body}>
                  {(selectedQuest.distanceMeters / 1000).toFixed(1)} km ·{' '}
                  {selectedQuest.estimatedActiveMinutes} min · {selectedQuest.checkpointCount}{' '}
                  {selectedQuest.checkpointCount === 1 ? 'checkpoint' : 'checkpoints'}
                </Text>
                {questDetail?.id === selectedQuest.id ? (
                  questDetail.checkpoints.map((checkpoint) => (
                    <Text key={checkpoint.id} style={styles.helper}>
                      {checkpoint.title}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.helper}>
                    {questUnavailable
                      ? 'Checkpoint details are unavailable.'
                      : 'Loading checkpoints…'}
                  </Text>
                )}
                {!dashboardPreviewEnabled && onOpenQuest && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onOpenQuest(selectedQuest)}
                    style={[styles.primary, styles.lineageAction]}
                  >
                    <Text style={styles.hudLabel}>Open quest</Text>
                  </Pressable>
                )}
              </View>
            )}
            {chosen ? (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.playerCopy}>
                    <Text style={styles.hudDetail}>{statusLabel(chosen)}</Text>
                    <Text accessibilityRole="header" style={styles.title}>
                      {chosen.cityTag ??
                        (chosen.owner.isSelf ? 'Your turf' : `${chosen.owner.displayName}’s turf`)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close claim details"
                    onPress={() => setSelected(undefined)}
                    style={styles.smallButton}
                  >
                    <Text style={styles.toolText}>×</Text>
                  </Pressable>
                </View>
                <Text style={styles.body}>
                  {Math.round(chosen.areaSqm).toLocaleString()} m² · {chosen.captureCount}{' '}
                  {chosen.captureCount === 1 ? 'capture' : 'captures'}
                </Text>
                <Text style={styles.helper}>
                  Held by {chosen.owner.isSelf ? 'you' : chosen.owner.displayName}
                </Text>
                {chosen.owner.isSelf ? (
                  <Text style={styles.helper}>
                    Somebody who runs this loop faster than you takes it.
                  </Text>
                ) : (
                  <Text style={styles.helper}>{targetPaceLabel(chosen.speedMps)}</Text>
                )}
                {ghost?.kind === 'rate_limited' && <Text style={styles.helper}>{ghost.note}</Text>}
                <View style={styles.cardActions}>
                  {ghost?.kind === 'available' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={ghost.label}
                      onPress={() => setGhostClaimId(chosen.id)}
                      style={[styles.primary, styles.ghostAction]}
                    >
                      <Text style={styles.ghostActionText}>Ghost Race</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open the full history of this territory"
                    onPress={() => {
                      setMapInfoOpen(false);
                      setShowDetail(true);
                    }}
                    style={[styles.primary, styles.lineageAction]}
                  >
                    <Text style={styles.hudLabel}>Lineage</Text>
                  </Pressable>
                </View>
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
                      // A run claims once (B4). Whether it just did or already
                      // had, there is nothing more to offer from it.
                      if (result.claimed || result.refusal === 'already_claimed')
                        setClaimableRunId(undefined);
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
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function PlayerBeacon({
  bearing,
  reduceMotion,
  styles
}: {
  bearing: number;
  reduceMotion: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion) return;
    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        useNativeDriver: true,
        isInteraction: false
      })
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return (
    <View style={styles.playerBeacon} accessible accessibilityLabel="Your position">
      <Animated.View
        style={[
          styles.radar,
          !reduceMotion && {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }
            ]
          }
        ]}
      />
      <View style={styles.playerCore}>
        <Text style={[styles.playerArrow, { transform: [{ rotate: `${bearing}deg` }] }]}>▲</Text>
      </View>
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    detailFrame: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 82 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    legendSwatch: { borderRadius: 3, height: 12, width: 12 },
    mapWrap: { backgroundColor: tokens.background.surfaceInset, flex: 1 },
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
    pinAnchor: { alignItems: 'center', justifyContent: 'center', width: 88, height: 72 },
    pinStem: { borderRadius: 2, height: 7, width: 2 },
    crownBadge: { position: 'absolute', top: 2, fontSize: 21, color: '#ffdb78' },
    defenseBadge: {
      position: 'absolute',
      right: 0,
      bottom: 10,
      borderRadius: 12,
      backgroundColor: '#27233e',
      borderColor: '#ffbf58',
      borderWidth: 1,
      paddingHorizontal: 5
    },
    revengeBadge: {
      position: 'absolute',
      top: 0,
      borderRadius: 12,
      backgroundColor: '#9d1d46',
      borderColor: '#ff6387',
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 2
    },
    revengeDim: { opacity: 0.64 },
    revengeBeacon: { position: 'relative', minHeight: 30, justifyContent: 'center' },
    badgeText: { color: '#fff5f8', fontSize: 9, fontWeight: '900' },
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
    tools: { alignSelf: 'flex-start', flexDirection: 'row', gap: 8 },
    hudHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingRight: typeof __DEV__ !== 'undefined' && __DEV__ ? 56 : 0
    },
    playerPill: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: 8,
      paddingVertical: 7,
      paddingHorizontal: 9,
      backgroundColor: '#0b1426ee',
      borderColor: '#3d587a',
      borderWidth: 1,
      borderRadius: 22
    },
    playerCopy: { flexShrink: 1 },
    avatarRing: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 39,
      height: 39,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: '#74eac6',
      backgroundColor: '#14253b'
    },
    seasonPill: {
      alignItems: 'center',
      backgroundColor: '#0b1426ee',
      borderWidth: 1,
      borderColor: '#3d587a',
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 7
    },
    hudLabel: { color: '#f0f7ff', fontSize: 14, fontWeight: '900' },
    hudDetail: { color: '#a8c4e8', fontSize: 10, fontWeight: '800' },
    xpTrack: {
      height: 3,
      marginTop: 3,
      backgroundColor: '#304967',
      borderRadius: 3,
      overflow: 'hidden'
    },
    xpFill: { height: '100%', backgroundColor: '#74eac6' },
    toolText: { color: '#e5f1ff', fontSize: 20, fontWeight: '800' },
    filterStatus: {
      alignSelf: 'flex-start',
      borderRadius: 12,
      backgroundColor: '#0b1426ee',
      color: '#d3e5fb',
      paddingHorizontal: 9,
      paddingVertical: 5,
      fontSize: 12
    },
    controlActive: { borderColor: SELF_RING },
    playerBeacon: { alignItems: 'center', height: 72, justifyContent: 'center', width: 72 },
    radar: {
      ...StyleSheet.absoluteFill,
      backgroundColor: '#31eaff24',
      borderColor: '#66f1ff',
      borderRadius: 36,
      borderWidth: 2
    },
    playerCore: {
      alignItems: 'center',
      backgroundColor: '#0b203d',
      borderColor: '#b9faff',
      borderRadius: 16,
      borderWidth: 2,
      height: 32,
      justifyContent: 'center',
      width: 32
    },
    playerArrow: { color: '#62efff', fontSize: 18, fontWeight: '900' },
    /** Search field and zone chips, floated over the top of the map. */
    zoneBar: { gap: 10, left: 12, position: 'absolute', right: 12, top: 12 },
    searchField: {
      alignItems: 'center',
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 16
    },
    searchGlyph: { color: tokens.text.secondary, fontSize: 17, fontWeight: '700' },
    searchInput: { color: tokens.text.primary, flex: 1, fontSize: 14, padding: 0 },
    filterRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
    filterChip: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderRadius: 999,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 34,
      paddingHorizontal: 14
    },
    filterChipActive: {
      backgroundColor: tokens.action.primary,
      borderColor: tokens.action.primary
    },
    filterChipText: { color: tokens.text.secondary, fontSize: 12, fontWeight: '800' },
    filterChipTextActive: { color: tokens.text.onAccent },
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
      bottom: 96,
      left: 12,
      padding: 10,
      position: 'absolute',
      right: 12
    },
    bannerText: { color: tokens.map.controlText, fontSize: 13, fontWeight: '700' },
    sheet: {
      backgroundColor: '#101a2df5',
      borderColor: '#355275',
      borderWidth: 1,
      borderRadius: 22,
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 96,
      maxHeight: '44%'
    },
    infoSheet: { maxHeight: '56%' },
    sheetScroll: { flexGrow: 0 },
    sheetContent: { gap: 8, padding: 12 },
    title: { color: '#f0f7ff', fontSize: 20, fontWeight: '900' },
    subtitle: { color: '#f0f7ff', fontSize: 15, fontWeight: '800', marginTop: 8 },
    body: { color: '#f0f7ff', fontSize: 14, lineHeight: 20 },
    helper: { color: '#bfd1e8', fontSize: 13, lineHeight: 18 },
    notice: { color: '#bfd1e8', fontSize: 13, lineHeight: 18 },
    feedLine: { color: '#bfd1e8', fontSize: 14, lineHeight: 20 },
    link: { color: '#bfd1e8', fontSize: 13, fontWeight: '800', marginTop: 6 },
    card: {
      gap: 4,
      padding: 2
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    },
    cardActions: { flexDirection: 'row', gap: 8, marginTop: 5 },
    questBeacon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: '#ffca5833',
      alignItems: 'center',
      justifyContent: 'center'
    },
    questBeaconCore: {
      width: 31,
      height: 31,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: '#ffe596',
      backgroundColor: '#4b351b',
      alignItems: 'center',
      justifyContent: 'center'
    },
    questGlyph: { color: '#ffe596', fontSize: 19, fontWeight: '900' },
    questAccent: { color: '#ffe596', fontSize: 11, fontWeight: '900' },
    smallButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    ghostAction: { flex: 1, backgroundColor: '#e94977' },
    ghostActionText: { color: '#140b1d', fontSize: 15, fontWeight: '900' },
    lineageAction: { flex: 1, backgroundColor: '#213454', borderColor: '#55779d', borderWidth: 1 },
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
