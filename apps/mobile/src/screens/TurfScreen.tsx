import { ProgressionBadge } from '../components/ProgressionBadge';
import { radius, space } from '@runsphere/ui';
import { NavigationIcon } from '../components/NavigationIcon';
import Svg, { Path } from 'react-native-svg';
import { linesFromGeometry } from './run-detail-layout-model';
import { routeThumbnailPath } from './run-log-model';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from 'react-native';
import { Text } from '../components/Text';
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
import {
  cachedTurfWorldStyle,
  hasTurfWorldStyle,
  loadTurfWorldStyle
} from '../maps/turf-world-style-cache';
import { useTurfPosition } from '../maps/use-turf-position';
import { useTurfExploration } from '../maps/use-turf-exploration';
import { fogFeatures } from '../maps/turf-exploration';
import { CrewMascot } from '../components/CrewMascot';
import { TerritoryDetailScreen } from './TerritoryDetailScreen';
import { GhostRaceSheet } from './GhostRaceSheet';
import { RunnerProfileSheet } from './RunnerProfileSheet';
import { seasonDaysLeft } from './home-progression-model';
import {
  dashboardPreviewEnabled,
  previewProgression,
  previewClaimHistory,
  previewClaims,
  previewGhostTrace
} from './dashboard-preview';
import { ghostOffer, type GhostRun } from './ghost-race-model';
import { ghostRaceHint } from './run-mode-model';
import { CLAIM_PUBLISHES_NOTICE, FIRST_CLAIM_PRIVACY_PROMPT } from '@runsphere/domain';
import {
  TIER_HINT,
  formatArea,
  isContested,
  activeEvents,
  efficiencyLabel,
  eventFeatures,
  eventLine,
  leaderboardRows,
  TRUNCATED_NOTE,
  boundsAround,
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
  type ZoneFilter,
  claimFailureNotice
} from './territory-claim-model';
import type { GameWorldPalette } from '../theme/game-world';
import { useGameWorld } from '../theme/use-game-world';
import { shouldShowTurfStory } from './turf-story-model';
import { setMapBuildings, useMapBuildings } from '../maps/map-preferences';

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
  requestedRunId?: string;
  readonly api: MobileApiClient;
  readonly accountId?: string;
  readonly onOpenRun?: () => void;
  readonly onClaimed?: () => void;
  readonly onOpenProfile?: () => void;
  /**
   * Leaves the tab to start a run with a ghost on the map. Optional, so a
   * caller that has nowhere to send the runner simply never shows the button.
   */
  readonly onGhostRace?: (run: GhostRun) => void;
  /**
   * The runner picked Ghost Race on the Run tab (M9 9.6) and came here to
   * choose whose ground to race, so the map says what to tap.
   */
  readonly ghostHint?: boolean;
  readonly onSessionExpired?: () => void;
  /**
   * False while another tab is open. The app keeps this screen mounted and
   * hidden after the first visit so coming back is instant; hidden, it stops
   * GPS, the pulse timer and the back button, and it refreshes when shown.
   */
  readonly visible?: boolean;
  /** Plays the How Turf works story (TurfStoryScreen). */
  readonly onOpenStory?: () => void;
  /**
   * Set while the first-run spotlight tour is up: the story waits rather than
   * stacking a second tour on top of the first.
   */
  readonly storyBlocked?: boolean;
}

/** Mumbai, so an empty first launch opens somewhere rather than at null island. */
const INITIAL_CENTRE: [number, number] = [72.8777, 19.076];
const INITIAL_ZOOM = 14.5;
/** How long the Map tab waits for the dark style before drawing the plain one. */
const STYLE_WAIT_MS = 2500;

/**
 * The last ground drawn, kept in memory for the session. The tab unmounts when
 * you leave it, so without this every return opened on an empty map until the
 * requests came back. Keyed by account so a sign-out never shows the next
 * person someone else's view; it is never written to disk.
 */
interface TurfVisit {
  accountId: string;
  claims: readonly TerritoryClaim[];
  truncated: boolean;
  mapNote: string;
  summary: TerritoryClaimSummary | undefined;
  feed: readonly TerritoryClaimActivityItem[];
  events: readonly TerritoryEvent[];
  board: TerritoryLeaderboardResponse | undefined;
}
let lastVisit: TurfVisit | undefined;

/**
 * Where the camera was, so the map reopens there rather than on Mumbai. Same
 * rules as `lastVisit`: per account, in memory only.
 */
interface TurfCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
}
let lastCamera: (TurfCamera & { accountId: string }) | undefined;

/**
 * How far past the top of the screen a camera at INITIAL_PITCH sees, as a
 * multiple of half the screen height. Only sizes the first request; the map's
 * own bounds take over once it has drawn.
 */
const PITCH_NORTH_REACH = 1.8;
const INITIAL_PITCH = 52;
/** The ring around a cluster that contains any of the reader's own ground. */
const SELF_RING = SELF_COLOUR;

export function TurfScreen({
  api,
  requestedRunId,
  accountId,
  onOpenRun,
  onClaimed,
  onOpenProfile,
  onGhostRace,
  ghostHint = false,
  onSessionExpired,
  visible = true,
  onOpenStory,
  storyBlocked = false
}: TurfScreenProps) {
  const { tokens, reduceMotion, colorScheme } = useAppTheme();
  const world = useGameWorld();
  const styles = useMemo(() => createStyles(tokens, world), [tokens, world]);
  const buildings = useMapBuildings();
  const day = colorScheme === 'light';
  const renderPlan = useMemo(() => resolveMapRenderPlan(), []);
  const providerUrl = renderPlan.kind === 'provider' ? renderPlan.provider.styleUrl : undefined;
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [styleReady, setStyleReady] = useState(
    () => !providerUrl || hasTurfWorldStyle(providerUrl)
  );
  /** Bumped when the download lands, so the derived style below is read again. */
  const [styleLoads, setStyleLoads] = useState(0);
  /** The restyled map failed to load once; draw the provider's own style instead. */
  const [styleFailed, setStyleFailed] = useState(false);
  const worldStyle = useMemo<StyleSpecification | undefined>(
    () =>
      providerUrl && !styleFailed
        ? cachedTurfWorldStyle(providerUrl, { scheme: colorScheme, buildings })
        : undefined,
    // styleLoads: re-read the cache once the download has landed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, colorScheme, providerUrl, styleFailed, styleLoads]
  );
  const [following, setFollowing] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapInfoOpen, setMapInfoOpen] = useState(false);
  const [intelRevision, setIntelRevision] = useState(0);
  const [viewport, setViewport] = useState<TerritoryClaimBounds>();
  const visited = useTurfExploration(accountId, dashboardPreviewEnabled);
  const [profile, setProfile] = useState<Profile>();
  const [progression, setProgression] = useState<ProgressionSummary>();
  const [pulseBright, setPulseBright] = useState(true);

  // What this runner saw on their last visit, drawn at once while fresh data loads.
  const [restored] = useState(() =>
    !dashboardPreviewEnabled && accountId && lastVisit?.accountId === accountId
      ? lastVisit
      : undefined
  );
  const [startCamera] = useState<TurfCamera>(() =>
    !dashboardPreviewEnabled && accountId && lastCamera?.accountId === accountId
      ? lastCamera
      : { center: INITIAL_CENTRE, zoom: INITIAL_ZOOM, bearing: 0 }
  );
  const [claims, setClaims] = useState<readonly TerritoryClaim[]>(
    dashboardPreviewEnabled ? previewClaims : (restored?.claims ?? [])
  );
  const [truncated, setTruncated] = useState(restored?.truncated ?? false);
  const [summary, setSummary] = useState<TerritoryClaimSummary | undefined>(
    dashboardPreviewEnabled
      ? { claimCount: 7, totalAreaSqm: 84_000, lostCount: 1 }
      : restored?.summary
  );
  const [feed, setFeed] = useState<readonly TerritoryClaimActivityItem[]>(restored?.feed ?? []);
  const [mapNote, setMapNote] = useState(
    dashboardPreviewEnabled
      ? 'Sample territories'
      : (restored?.mapNote ?? 'Territory shows the loops people ran and the holder’s name.')
  );
  const [zoom, setZoom] = useState(startCamera.zoom);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string>();
  /** A holder's profile opened from the claim card (SI.6). */
  const [holderProfile, setHolderProfile] = useState<string>();
  useEffect(() => setHolderProfile(undefined), [selected]);
  /** The zone bar: which ground is drawn, and the name being looked for. */
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');
  const [claimableRunId, setClaimableRunId] = useState<string>();
  const [claimRoute, setClaimRoute] = useState<{ id: string; path?: string }>();
  useEffect(() => {
    if (!claimableRunId || claimableRunId !== requestedRunId) return;
    let active = true;
    const inspectRun = async () => {
      try {
        const detail = await api.activityStatus(claimableRunId);
        const outline =
          detail.status === 'derived'
            ? routeThumbnailPath(linesFromGeometry(detail.geometry) ?? null, 80)
            : null;
        if (active)
          setClaimRoute({ id: claimableRunId, ...(outline?.path ? { path: outline.path } : {}) });
      } catch {
        if (active) setClaimRoute({ id: claimableRunId });
      }
    };
    void inspectRun();
    return () => {
      active = false;
    };
  }, [api, claimableRunId, requestedRunId]);
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
  const [recommendations, setRecommendations] = useState<readonly TerritoryRecommendation[]>();
  const [recommendationNote, setRecommendationNote] = useState('');
  const [notEnoughRuns, setNotEnoughRuns] = useState(false);
  const [celebration, setCelebration] = useState<CaptureCelebration>();
  const [showDetail, setShowDetail] = useState(false);
  const [privacyPrompt, setPrivacyPrompt] = useState(false);
  const [events, setEvents] = useState<readonly TerritoryEvent[]>(restored?.events ?? []);
  const [board, setBoard] = useState<TerritoryLeaderboardResponse | undefined>(restored?.board);
  useEffect(() => {
    if (dashboardPreviewEnabled || !accountId) return;
    lastVisit = { accountId, claims, truncated, mapNote, summary, feed, events, board };
  }, [accountId, board, claims, events, feed, mapNote, summary, truncated]);
  const { position, requestPosition } = useTurfPosition(
    visible && Boolean(providerUrl) && !showDetail && !ghostClaimId,
    dashboardPreviewEnabled
  );
  const lastBounds = useRef<TerritoryClaimBounds | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    if (!providerUrl || hasTurfWorldStyle(providerUrl)) return;
    let current = true;
    // Hold the map back until the dark style is in hand, so it's built once
    // rather than drawn plain and rebuilt. A slow style server must not leave
    // the tab blank, so after a short wait it draws the plain map anyway.
    const fallback = setTimeout(() => {
      if (current) setStyleReady(true);
    }, STYLE_WAIT_MS);
    void loadTurfWorldStyle(providerUrl, { scheme: colorScheme, buildings }).then(() => {
      if (!current) return;
      clearTimeout(fallback);
      setStyleLoads((count) => count + 1);
      setStyleReady(true);
    });
    return () => {
      current = false;
      clearTimeout(fallback);
    };
    // Only the first download matters; variants are built from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerUrl]);

  useEffect(() => {
    if (!following || !position || showDetail || ghostClaimId) return;
    cameraRef.current?.setStop({
      center: position.center,
      bearing: position.bearing,
      duration: reduceMotion ? 0 : 450
    });
  }, [following, ghostClaimId, position, reduceMotion, showDetail]);

  useEffect(() => {
    // Hidden behind another tab, the back button belongs to that tab.
    if (!visible || (!mapInfoOpen && !selected && !filtersOpen)) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mapInfoOpen) setMapInfoOpen(false);
      else if (filtersOpen) setFiltersOpen(false);
      else if (ghostClaimId) setGhostClaimId(undefined);
      else if (showDetail) setShowDetail(false);
      else if (selected) setSelected(undefined);
      else return false;
      return true;
    });
    return () => listener.remove();
  }, [filtersOpen, ghostClaimId, mapInfoOpen, selected, showDetail, visible]);

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
      const [mine, runs, eventList] = await Promise.all([
        api.getTerritoryClaimSummary(),
        // Claiming is something a person does, not something that happens to
        // them: a run only reaches the map when they say so (ADR-0011).
        api.listActivities().catch(() => []),
        api.getTerritoryEvents().catch(() => ({ data: [] }))
      ]);
      if (!mounted.current) return;
      setSummary(mine);
      setEvents(eventList.data);
      const candidate = pickClaimableRun(runs, requestedRunId);
      setClaimableRunId(candidate);
      if (requestedRunId && !candidate) {
        const alreadyClaimed = runs.some(
          (run) => run.id === requestedRunId && run.territoryClaimed
        );
        if (!alreadyClaimed)
          setNotice('This run has no claim ready. Check your runs to see where it’s at.');
      }
    } catch {
      // The map is the point of the screen; a failed sidebar must not take it
      // down with it.
    }
  }, [api, requestedRunId]);

  // Also runs each time the tab is shown again, so a run claimed elsewhere
  // shows up here; nothing is fetched while it sits hidden.
  useEffect(() => {
    if (!dashboardPreviewEnabled && visible) void loadMine();
  }, [loadMine, visible]);

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

  const loadViewport = useCallback(
    (next: TerritoryClaimBounds, atZoom: number) => {
      // Zoomed out, the map asks for activity blobs; zoomed in, for territories.
      // Asking for both at every zoom would ship a continent of polygons to draw
      // a dozen dots.
      if (showsClusters(detailTierFor(atZoom))) {
        void loadClusters(next);
        return;
      }
      void loadClaims(next);
    },
    [loadClaims, loadClusters]
  );

  const onRegionChanged = (event: { nativeEvent: ViewStateChangeEvent }) => {
    if (!visible) return;
    const { bounds, center, zoom: nextZoom } = event.nativeEvent;
    setZoom(nextZoom);
    setBearing(event.nativeEvent.bearing ?? 0);
    if (dashboardPreviewEnabled) return;
    if (accountId)
      lastCamera = {
        accountId,
        center: [center[0], center[1]],
        zoom: nextZoom,
        bearing: event.nativeEvent.bearing ?? 0
      };
    const next = boundsFrom(bounds);
    if (!worthRefetching(lastBounds.current, next)) return;
    lastBounds.current = next;
    setViewport(next);
    loadViewport(next, nextZoom);
  };

  // Ask for the ground under the opening camera straight away, in parallel
  // with the style and tiles, rather than after the map's first region event.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const firstViewport = useRef({ width: screenWidth, height: screenHeight });
  useEffect(() => {
    if (dashboardPreviewEnabled || !providerUrl) return;
    const next = boundsAround(
      startCamera.center,
      startCamera.zoom,
      firstViewport.current,
      PITCH_NORTH_REACH
    );
    lastBounds.current = next;
    setViewport(next);
    loadViewport(next, startCamera.zoom);
  }, [loadViewport, providerUrl, startCamera]);

  // The first time this runner opens the map, the story plays once (plan, Feature A).
  const storyChecked = useRef(false);
  useEffect(() => {
    if (!visible || storyBlocked || !accountId || !onOpenStory || dashboardPreviewEnabled) return;
    if (storyChecked.current) return;
    storyChecked.current = true;
    let current = true;
    void shouldShowTurfStory(accountId).then((show) => {
      if (current && show) onOpenStory();
    });
    return () => {
      current = false;
    };
  }, [accountId, onOpenStory, storyBlocked, visible]);

  // Coming back from another tab: the ground may have changed while hidden.
  const wasVisible = useRef(visible);
  useEffect(() => {
    const returning = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (returning && !dashboardPreviewEnabled && lastBounds.current)
      loadViewport(lastBounds.current, zoom);
  }, [loadViewport, visible, zoom]);

  const tier = detailTierFor(zoom);
  const clustered = !dashboardPreviewEnabled && showsClusters(tier);
  useEffect(() => {
    if (!visible || !mapInfoOpen || dashboardPreviewEnabled) return;
    let active = true;
    void api.getTerritoryClaimActivity().then(
      ({ data }) => {
        if (active) setFeed(data);
      },
      () => undefined
    );
    void api.getTerritoryLeaderboard().then(
      (leaderboard) => {
        if (active) setBoard(leaderboard);
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [api, intelRevision, mapInfoOpen, visible]);

  useEffect(() => {
    if (!visible || !mapInfoOpen || !viewport || clustered || dashboardPreviewEnabled) return;
    let active = true;
    setRecommendations(undefined);
    setRecommendationNote('');
    setNotEnoughRuns(false);
    void api.getTerritoryRecommendations(viewport).then(
      (response) => {
        if (!active) return;
        setRecommendations(response.data);
        setRecommendationNote(response.note);
        setNotEnoughRuns(response.unavailableReason === 'not_enough_runs');
      },
      () => {
        if (active) setRecommendations([]);
      }
    );
    return () => {
      active = false;
    };
  }, [api, clustered, intelRevision, mapInfoOpen, viewport, visible]);
  /**
   * The bar narrows what is drawn, not what was loaded: the summary line below
   * still counts everything in the viewport, so a filter that hides every zone
   * reads as a filter rather than as empty ground.
   */
  const visibleClaims = useMemo(() => filterClaims(claims, zoneFilter), [claims, zoneFilter]);
  const features = useMemo(
    () => claimFeatures(clustered ? [] : visibleClaims),
    [visibleClaims, clustered]
  );
  const fog = useMemo(
    () => fogFeatures(clustered ? undefined : viewport, visited),
    [clustered, viewport, visited]
  );
  const showGrid = !clustered && (dashboardPreviewEnabled || zoom >= 15.5);
  const gridFeatures = useMemo(
    () => claimGridFeatures(showGrid ? visibleClaims : []),
    [showGrid, visibleClaims]
  );
  const hasPulse =
    !clustered && visibleClaims.some((claim) => isContested(claim) || claim.revengeAvailable);
  useEffect(() => {
    if (!visible || !hasPulse || reduceMotion || showDetail || ghostClaimId) return;
    const timer = setInterval(() => setPulseBright((bright) => !bright), 1050);
    return () => clearInterval(timer);
  }, [ghostClaimId, hasPulse, reduceMotion, showDetail, visible]);
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

  const hudProgression = dashboardPreviewEnabled ? previewProgression : progression;

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
        {hudProgression && (
          <View style={styles.detailStatus}>
            <ProgressionBadge summary={hudProgression} turf hud={world.hud} />
          </View>
        )}
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

  const playerName = dashboardPreviewEnabled ? 'Maya Chen' : (profile?.displayName ?? 'Runner');
  const avatarKey = dashboardPreviewEnabled ? 'loop-1' : profile?.cosmetic?.avatarKey;
  const ghost = chosen && onGhostRace ? ghostOffer(chosen, summary?.ghostRacesLeft) : undefined;
  const selectClaim = (id: string) => {
    setMapInfoOpen(false);
    setSelected(id);
  };

  return (
    <View style={styles.root}>
      <View style={styles.mapWrap}>
        {renderPlan.kind === 'provider' && !styleReady ? (
          <View
            accessible
            accessibilityLabel="Loading the map"
            style={[StyleSheet.absoluteFill, styles.mapPending]}
          />
        ) : renderPlan.kind === 'provider' ? (
          <Map
            // Remount when the style changes (day/night, 3D on/off, or the
            // provider fallback). Swapping the style on a live map reloads it
            // and drops the GeoJSON layers already added, so held ground, fog
            // and event areas vanished while the marker views stayed.
            key={worldStyle ? `turf-world-${colorScheme}-${buildings ? '3d' : 'flat'}` : 'provider'}
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
              if (worldStyle) setStyleFailed(true);
            }}
            onRegionWillChange={(event) => {
              if (event.nativeEvent.userInteraction) setFollowing(false);
            }}
            onRegionDidChange={onRegionChanged}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{
                center: startCamera.center,
                zoom: startCamera.zoom,
                bearing: startCamera.bearing,
                pitch: INITIAL_PITCH
              }}
            />
            {fog.features.length > 0 && (
              <GeoJSONSource id="turf-private-fog" data={fog}>
                <Layer
                  id="turf-private-fog-fill"
                  type="fill"
                  paint={{
                    'fill-color': world.map.fog,
                    'fill-opacity': 0.32,
                    'fill-antialias': false
                  }}
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
                  // A glow is light on night ground; on paper it only blurs the edge.
                  'line-opacity': day ? 0.3 : 0.7
                }}
              />
              {day && (
                // Lime is 1.14:1 on paper: the casing is what draws the edge.
                <Layer
                  id="turf-claims-casing"
                  type="line"
                  paint={{
                    'line-color': world.map.casing,
                    'line-width': 4.5,
                    'line-opacity': 0.55
                  }}
                />
              )}
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
                    TURFR has no uploaded profile photos — identity is a
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
            <Text style={styles.fallbackTitle}>The map isn't available</Text>
            <Text style={styles.body}>
              Your ground still counts, and the list below shows all of it. The map will be back
              soon.
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
              accessibilityLabel={playerName}
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
              </View>
            </Pressable>
            <ProgressionBadge summary={hudProgression} turf hud={world.hud} />
          </View>
          <View style={styles.tools} pointerEvents="box-none">
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
              <NavigationIcon name="layers" color={world.hud.tool} />
            </Pressable>
            {providerUrl && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Center on my location"
                accessibilityState={{ selected: following }}
                onPress={() => void recenter()}
                style={[styles.control, following && styles.controlActive]}
              >
                <NavigationIcon name="locate" color={world.hud.tool} />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open map intel"
              accessibilityState={{ expanded: mapInfoOpen }}
              onPress={() => setMapInfoOpen((open) => !open)}
              style={styles.control}
            >
              <NavigationIcon name="info" color={world.hud.tool} />
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
          {filtersOpen && (
            <ScrollView
              horizontal
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
              {/* A view setting, not a filter: kept on this device for every map. */}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: buildings }}
                accessibilityLabel="3D buildings"
                onPress={() => setMapBuildings(!buildings)}
                style={[styles.filterChip, buildings && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, buildings && styles.filterChipTextActive]}>
                  3D buildings
                </Text>
              </Pressable>
            </ScrollView>
          )}
          {(filtersOpen || zoneFilter !== 'all') && (
            <Text style={styles.filterStatus}>
              {zoneFilterSummary(zoneFilter, visibleClaims.length, claims.length)}
            </Text>
          )}
        </View>

        {ghostHint && onGhostRace && !chosen ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Text style={styles.bannerText}>{ghostRaceHint(claims, summary?.ghostRacesLeft)}</Text>
          </View>
        ) : null}
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
              {zoneFilterSummary(zoneFilter, visibleClaims.length, claims.length)}
            </Text>
            <Text style={styles.helper}>{summaryLine(summary)}</Text>
            {onOpenStory ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMapInfoOpen(false);
                  onOpenStory();
                }}
              >
                <Text style={styles.link}>How Turf works</Text>
              </Pressable>
            ) : null}
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
                    Run a few more times and TURFR can estimate which territories are within reach.
                  </Text>
                ) : !recommendations && viewport && !dashboardPreviewEnabled ? (
                  <Text style={styles.helper}>Finding nearby territories…</Text>
                ) : !recommendations?.length ? (
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
      ) : chosen || claimableRunId || notice || celebration ? (
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
                  {formatArea(chosen.areaSqm)} · {chosen.captureCount}{' '}
                  {chosen.captureCount === 1 ? 'capture' : 'captures'}
                </Text>
                <Text style={styles.helper}>
                  Held by {chosen.owner.isSelf ? 'you' : chosen.owner.displayName}
                </Text>
                {!chosen.owner.isSelf && chosen.owner.username ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open @${chosen.owner.username}'s profile`}
                    onPress={() => setHolderProfile(chosen.owner.username)}
                  >
                    <Text style={styles.link}>{`View @${chosen.owner.username}`}</Text>
                  </Pressable>
                ) : null}
                {holderProfile ? (
                  <RunnerProfileSheet
                    api={api}
                    username={holderProfile}
                    onClose={() => setHolderProfile(undefined)}
                  />
                ) : null}
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

            {claimableRunId && claimableRunId === requestedRunId ? (
              <View style={styles.claimPreview}>
                {claimRoute?.id === claimableRunId && claimRoute.path ? (
                  <Svg width={64} height={64} viewBox="0 0 80 80" accessible={false}>
                    <Path
                      d={claimRoute.path}
                      fill="none"
                      stroke={world.hud.tool}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                ) : null}
                <View style={styles.claimPreviewCopy}>
                  <Text style={styles.hudLabel}>Your loop</Text>
                  <Text style={styles.helper}>
                    {claimRoute?.id !== claimableRunId
                      ? 'Loading your route…'
                      : claimRoute.path
                        ? 'This is the route visible after your privacy settings are applied.'
                        : 'A route preview is unavailable.'}
                  </Text>
                </View>
              </View>
            ) : null}
            {claimableRunId && (requestedRunId || (summary?.claimCount ?? 0) === 0) ? (
              <Text style={styles.helper}>{CLAIM_PUBLISHES_NOTICE}</Text>
            ) : null}
            {claimableRunId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  requestedRunId ? 'Claim ground from this run' : 'Claim ground from your last run'
                }
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
                        onClaimed?.();
                        setIntelRevision((revision) => revision + 1);
                        setCelebration(captureCelebration(result.claim, result.takenOverCount));
                        // Said once, the moment it becomes true, rather than
                        // inferred from where somebody lives.
                        if (result.isFirstClaim) setPrivacyPrompt(true);
                        await loadMine();
                        if (lastBounds.current) await loadClaims(lastBounds.current);
                      }
                    } catch (error) {
                      if (mounted.current) setNotice(claimFailureNotice(error));
                    } finally {
                      if (mounted.current) setClaiming(false);
                    }
                  })()
                }
                style={styles.primary}
              >
                <Text style={styles.primaryText}>
                  {claiming
                    ? 'Claiming…'
                    : requestedRunId
                      ? 'Claim ground from this run'
                      : 'Claim ground from your last run'}
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

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens'], world: GameWorldPalette) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    detailFrame: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 82 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: 6 },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    legendSwatch: { borderRadius: 3, height: 12, width: 12 },
    mapWrap: { backgroundColor: tokens.background.surfaceInset, flex: 1 },
    /** The night ground the dark style opens on, so the wait doesn't flash light. */
    mapPending: { backgroundColor: world.map.night },
    fallback: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
    fallbackTitle: {
      color: tokens.text.primary,
      fontSize: 17,
      fontWeight: '700',
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
    crownBadge: { position: 'absolute', top: 2, fontSize: 20, color: world.badge.crown },
    defenseBadge: {
      position: 'absolute',
      right: 0,
      bottom: 10,
      borderRadius: radius.control,
      backgroundColor: world.badge.shield,
      borderColor: world.badge.shieldRim,
      borderWidth: 1,
      paddingHorizontal: 5
    },
    revengeBadge: {
      position: 'absolute',
      top: 0,
      borderRadius: radius.control,
      backgroundColor: world.badge.revenge,
      borderColor: world.badge.revengeRim,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: space.xxs
    },
    revengeDim: { opacity: 0.64 },
    revengeBeacon: { position: 'relative', minHeight: 30, justifyContent: 'center' },
    badgeText: { color: world.badge.text, fontSize: 11, fontWeight: '700' },
    bubble: {
      alignItems: 'center',
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.strong,
      borderWidth: 3,
      justifyContent: 'center'
    },
    bubbleText: { color: tokens.text.primary, fontSize: 14, fontWeight: '700' },
    celebration: {
      backgroundColor: tokens.background.surfaceInset,
      borderColor: SELF_RING,
      borderRadius: radius.card,
      borderWidth: 2,
      gap: space.xs,
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
    rank: { color: tokens.text.primary, fontSize: 14, fontWeight: '700', minWidth: 34 },
    celebrationHeadline: { color: tokens.text.primary, fontSize: 17, fontWeight: '700' },
    celebrationDetail: { color: tokens.text.primary, fontSize: 14, lineHeight: 20 },
    tools: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs
    },
    hudHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md
    },
    playerPill: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: space.sm,
      paddingVertical: 7,
      paddingHorizontal: 9,
      backgroundColor: world.hud.glass,
      borderColor: world.hud.edgeSoft,
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
      borderColor: world.hud.progress,
      backgroundColor: world.hud.avatar
    },
    detailStatus: { paddingHorizontal: space.lg, paddingVertical: space.xs },
    seasonPill: {
      alignItems: 'center',
      backgroundColor: world.hud.glass,
      borderWidth: 1,
      borderColor: world.hud.edgeSoft,
      borderRadius: 18,
      marginLeft: 'auto',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: space.md,
      paddingVertical: space.xs
    },
    claimPreview: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    claimPreviewCopy: { flex: 1 },
    hudLabel: { color: world.hud.text, fontSize: 14, fontWeight: '700' },
    hudDetail: { color: world.hud.detail, fontSize: 11, fontWeight: '700' },
    toolText: { color: world.hud.tool, fontSize: 20, fontWeight: '700' },
    filterStatus: {
      alignSelf: 'flex-start',
      borderRadius: radius.control,
      backgroundColor: world.hud.glass,
      color: world.hud.status,
      paddingHorizontal: 9,
      paddingVertical: 5,
      fontSize: 12
    },
    controlActive: { borderColor: SELF_RING },
    playerBeacon: { alignItems: 'center', height: 72, justifyContent: 'center', width: 72 },
    radar: {
      ...StyleSheet.absoluteFill,
      backgroundColor: world.player.radar,
      borderColor: world.player.radarRing,
      borderRadius: 36,
      borderWidth: 2
    },
    playerCore: {
      alignItems: 'center',
      backgroundColor: world.player.core,
      borderColor: world.player.coreRing,
      borderRadius: radius.card,
      borderWidth: 2,
      height: 32,
      justifyContent: 'center',
      width: 32
    },
    playerArrow: { color: world.player.arrow, fontSize: 17, fontWeight: '700' },
    /** Map controls and zone chips, floated over the top of the map. */
    zoneBar: { gap: 10, left: 12, position: 'absolute', right: 12, top: 12 },
    filterRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.sm },
    filterChip: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 34,
      paddingHorizontal: 14
    },
    filterChipActive: {
      backgroundColor: tokens.action.primary,
      borderColor: tokens.action.primary
    },
    filterChipText: { color: tokens.text.secondary, fontSize: 12, fontWeight: '700' },
    filterChipTextActive: { color: tokens.text.onAccent },
    control: {
      alignItems: 'center',
      backgroundColor: world.hud.glass,
      borderColor: world.hud.edgeSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    controlText: { color: tokens.map.controlText, fontSize: 20, fontWeight: '700' },
    banner: {
      backgroundColor: tokens.map.scrim,
      borderRadius: radius.control,
      bottom: 96,
      left: 12,
      padding: 10,
      position: 'absolute',
      right: 12
    },
    bannerText: { color: tokens.map.controlText, fontSize: 13, fontWeight: '700' },
    sheet: {
      backgroundColor: world.hud.sheet,
      borderColor: world.hud.edge,
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
    sheetContent: { gap: space.sm, padding: space.md },
    title: { color: world.hud.text, fontSize: 20, fontWeight: '700' },
    subtitle: { color: world.hud.text, fontSize: 15, fontWeight: '700', marginTop: space.sm },
    body: { color: world.hud.text, fontSize: 14, lineHeight: 20 },
    helper: { color: world.hud.textSoft, fontSize: 13, lineHeight: 18 },
    notice: { color: world.hud.textSoft, fontSize: 13, lineHeight: 18 },
    feedLine: { color: world.hud.textSoft, fontSize: 14, lineHeight: 20 },
    link: { color: world.hud.textSoft, fontSize: 13, fontWeight: '700', marginTop: 6 },
    card: {
      gap: space.xs,
      padding: space.xxs
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm
    },
    cardActions: { flexDirection: 'row', gap: space.sm, marginTop: 5 },
    smallButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    ghostAction: { flex: 1, backgroundColor: world.action.ghost },
    ghostActionText: { color: world.action.ghostText, fontSize: 15, fontWeight: '700' },
    lineageAction: {
      flex: 1,
      backgroundColor: world.action.lineage,
      borderColor: world.action.lineageRim,
      borderWidth: 1
    },
    primary: {
      alignItems: 'center',
      backgroundColor: tokens.action.primary,
      borderRadius: radius.card,
      justifyContent: 'center',
      minHeight: 48,
      marginTop: space.xs
    },
    primaryText: { color: tokens.text.onAccent, fontSize: 15, fontWeight: '700' }
  });
