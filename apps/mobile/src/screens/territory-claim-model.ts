import type { FeatureCollection, Polygon } from 'geojson';
import type {
  TerritoryClaim,
  TerritoryClaimActivityItem,
  TerritoryClaimBounds,
  TerritoryClaimHistoryEntry,
  TerritoryClaimSummary,
  TerritoryCluster,
  TerritoryEvent,
  TerritoryLeaderboardEntry,
  TerritoryLeaderboardResponse,
  TerritoryRecommendation
} from '@runsphere/contracts';
import { crewCharacters, type CrewCharacter } from '../crew';

/**
 * The turf map as the app draws it (Phase 5, milestone 5.1; ADR-0011).
 *
 * Everything here is pure so the map itself stays a renderer: which colour a
 * person is, where their avatar sits, when a pan is worth another request, and
 * how a time or an area is worded.
 */

/**
 * Holder colours. Fixed and deterministic so one person is the same colour on
 * everybody's screen — a map where the same rival changes colour between
 * sessions is unreadable, and colour is the only thing distinguishing two
 * adjacent claims at a glance.
 */
export const OWNER_PALETTE = [
  '#A855F7',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#10B981'
] as const;

/** The reader's own ground, always this colour whatever their id hashes to. */
export const SELF_COLOUR = '#C9F15A';

/** FNV-1a, so the same account always lands on the same colour. */
export const ownerColour = (accountId: string, isSelf = false): string => {
  if (isSelf) return SELF_COLOUR;
  let hash = 0x811c9dc5;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return OWNER_PALETTE[hash % OWNER_PALETTE.length]!;
};

export interface ClaimFeatureProperties {
  claimId: string;
  colour: string;
  isSelf: boolean;
}

/**
 * The claims as one source the renderer can paint in a single pass.
 *
 * The ring arrives open from the server and is closed here, because GeoJSON
 * requires it and the wire does not.
 */
export const claimFeatures = (
  claims: readonly TerritoryClaim[]
): FeatureCollection<Polygon, ClaimFeatureProperties> => ({
  type: 'FeatureCollection',
  features: claims
    .filter((claim) => claim.boundary.length >= 3)
    .map((claim) => ({
      type: 'Feature' as const,
      properties: {
        claimId: claim.id,
        colour: ownerColour(claim.owner.id, claim.owner.isSelf),
        isSelf: claim.owner.isSelf
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[...claim.boundary.map(([lng, lat]) => [lng, lat]), [...claim.boundary[0]!]]]
      }
    }))
});

export interface ClaimMarker {
  claimId: string;
  lngLat: [number, number];
  displayName: string;
  avatarKey: string;
  colour: string;
  isSelf: boolean;
  accessibilityLabel: string;
}

/** Seconds as `m:ss`, the way a lap time is read. */
export const formatLoopTime = (seconds: number): string => {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
};

/** Area in the unit a person can picture: hectares until it is square kilometres. */
export const formatArea = (areaSqm: number): string => {
  if (areaSqm >= 1_000_000) return `${(areaSqm / 1_000_000).toFixed(1)} km²`;
  return `${(areaSqm / 10_000).toFixed(1)} ha`;
};

/**
 * One avatar per claim, at its centroid.
 *
 * The accessible label carries what the picture conveys — whose ground it is
 * and the time to beat — because the map is the one surface where a sighted
 * reader gets information purely from position and colour.
 */
export const claimMarkers = (claims: readonly TerritoryClaim[]): ClaimMarker[] =>
  claims.map((claim) => {
    const colour = ownerColour(claim.owner.id, claim.owner.isSelf);
    const time = formatLoopTime(claim.durationSeconds);
    const area = formatArea(claim.areaSqm);
    return {
      claimId: claim.id,
      lngLat: claim.centroid,
      displayName: claim.owner.displayName,
      avatarKey: claim.owner.avatarKey,
      colour,
      isSelf: claim.owner.isSelf,
      accessibilityLabel: claim.owner.isSelf
        ? `Your ground, ${area}, held in ${time}.`
        : `${claim.owner.displayName} holds ${area} in ${time}. Beat that time to take it.`
    };
  });

/**
 * Whether a viewport has moved enough to be worth asking the server again.
 *
 * A map fires a change event for every frame of a pan; refetching on each one
 * would put the network in the middle of a gesture. The threshold is a fraction
 * of the span rather than a fixed distance, so it behaves the same zoomed into a
 * street and out over a city.
 */
export const worthRefetching = (
  previous: TerritoryClaimBounds | undefined,
  next: TerritoryClaimBounds,
  movedFraction = 0.25
): boolean => {
  if (!previous) return true;
  const width = Math.abs(previous.east - previous.west);
  const height = Math.abs(previous.north - previous.south);
  if (width === 0 || height === 0) return true;
  // A zoom changes the span; a pan changes the corners. Either counts.
  const zoomed =
    Math.abs(Math.abs(next.east - next.west) - width) / width > movedFraction ||
    Math.abs(Math.abs(next.north - next.south) - height) / height > movedFraction;
  const panned =
    Math.abs(next.west - previous.west) / width > movedFraction ||
    Math.abs(next.south - previous.south) / height > movedFraction;
  return zoomed || panned;
};

/** `[west, south, east, north]` as the map reports it, as the API wants it. */
export const boundsFrom = (
  bounds: readonly [number, number, number, number]
): TerritoryClaimBounds => ({
  west: bounds[0],
  south: bounds[1],
  east: bounds[2],
  north: bounds[3]
});

/** The reader's standing, in a line. Ground held, never a rank. */
export const summaryLine = (summary: TerritoryClaimSummary | undefined): string => {
  if (!summary || summary.claimCount === 0)
    return 'You hold no ground yet. Run a closed loop to claim some.';
  const held = `${summary.claimCount === 1 ? '1 claim' : `${summary.claimCount} claims`}, ${formatArea(summary.totalAreaSqm)}`;
  return summary.lostCount === 0
    ? held
    : `${held} · ${summary.lostCount === 1 ? '1 taken from you' : `${summary.lostCount} taken from you`}`;
};

/**
 * One line of the takeover feed.
 *
 * Losing ground is the event that makes or breaks this game, so it is worded as
 * something that happened to a person, with both times, rather than as a status
 * change.
 */
export const takeoverLine = (item: TerritoryClaimActivityItem): string => {
  const rival = item.rival?.displayName ?? 'Someone';
  const from = formatLoopTime(item.previousDurationSeconds);
  const to = formatLoopTime(item.newDurationSeconds);
  return item.takenFromSelf
    ? `${rival} took your ground — ${to} against your ${from}.`
    : `You took ground from ${rival} — ${to} against their ${from}.`;
};

/**
 * Said under the map when a viewport held more claims than the server returns.
 * Silence here would read as "this is all the ground there is".
 */
export const TRUNCATED_NOTE = 'Too much ground to draw at this zoom. Zoom in to see it all.';

/**
 * How much detail the map shows, by zoom (the spec's four levels).
 *
 * Individual territories are not drawn at world or region zoom: thousands of
 * small polygons is a slow response and an unreadable picture, so those zooms
 * ask for clusters instead. Street zoom draws the same territories as city
 * zoom, and the surrounding UI reveals more about the one being looked at.
 */
export type MapDetailTier = 'world' | 'region' | 'city' | 'street';

export const detailTierFor = (zoom: number): MapDetailTier => {
  if (zoom < 5) return 'world';
  if (zoom < 11) return 'region';
  return zoom < 15 ? 'city' : 'street';
};

/** Clusters at world and region zoom, individual claims from city zoom in. */
export const showsClusters = (tier: MapDetailTier): boolean =>
  tier === 'world' || tier === 'region';

export interface ClusterMarker {
  key: string;
  lngLat: [number, number];
  label: string;
  includesSelf: boolean;
  accessibilityLabel: string;
  /** Grows with how much is held here, bounded so a hotspot cannot fill the map. */
  size: number;
}

/**
 * A cluster as a bubble. The number shown is people, not polygons: "42 runners
 * hold ground here" is a thing somebody can picture, and a claim count is not.
 */
export const clusterMarkers = (clusters: readonly TerritoryCluster[]): ClusterMarker[] =>
  clusters.map((cluster, index) => ({
    key: `${cluster.centroid[0].toFixed(3)}:${cluster.centroid[1].toFixed(3)}:${index}`,
    lngLat: [cluster.centroid[0], cluster.centroid[1]],
    label: String(cluster.holderCount),
    includesSelf: cluster.includesSelf,
    size: Math.min(64, 34 + Math.round(Math.log10(cluster.claimCount + 1) * 18)),
    accessibilityLabel: cluster.includesSelf
      ? `${cluster.holderCount} runners hold ground here, including you. ${formatArea(cluster.totalAreaSqm)} in total.`
      : `${cluster.holderCount} runners hold ground here. ${formatArea(cluster.totalAreaSqm)} in total.`
  }));

/** What a reader is told at world and region zoom, instead of empty ground. */
export const TIER_HINT: Readonly<Record<MapDetailTier, string>> = {
  world: 'Zoom in to a city to see who holds what.',
  region: 'Zoom in further to see individual territories.',
  city: '',
  street: ''
};

/**
 * Which crew mascot stands in for an avatar.
 *
 * RunSphere has no uploaded profile photos — identity is a cosmetic key — so a
 * pin shows the crew character that key maps to. Deterministic, so a person
 * looks the same on the map every time.
 */
export const crewForAvatar = (avatarKey: string): CrewCharacter => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < avatarKey.length; index += 1) {
    hash ^= avatarKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return crewCharacters[hash % crewCharacters.length]!;
};

/** How a territory's state is worded on the card. */
export const statusLabel = (claim: TerritoryClaim): string => {
  if (claim.status === 'club_controlled')
    return claim.club ? `Held for ${claim.club.name}` : 'Club ground';
  return claim.status === 'contested' ? 'Contested ground' : 'Held';
};

/**
 * The line under a territory's name: what it takes to run it, and how hard it
 * has been fought over.
 */
export const territoryFacts = (claim: TerritoryClaim): string => {
  const parts = [formatArea(claim.areaSqm), `record ${formatLoopTime(claim.durationSeconds)}`];
  if (claim.distanceMetres && claim.distanceMetres > 0)
    parts.splice(1, 0, `${(claim.distanceMetres / 1000).toFixed(1)} km loop`);
  parts.push(
    claim.captureCount === 1 ? 'never taken' : `changed hands ${claim.captureCount} times`
  );
  return parts.join(' · ');
};

/** One line of a territory's story. */
export const historyLine = (entry: TerritoryClaimHistoryEntry): string => {
  const who = entry.owner?.isSelf ? 'You' : (entry.owner?.displayName ?? 'A runner');
  const when = entry.claimedAt.slice(0, 10);
  return entry.releasedAt
    ? `${who} — ${formatLoopTime(entry.durationSeconds)}, held from ${when}`
    : `${who} — ${formatLoopTime(entry.durationSeconds)}, holding since ${when}`;
};

/**
 * A recommendation, worded as an estimate somebody can disagree with.
 *
 * The percentage is never presented alone: it always arrives next to the two
 * times it came from, so a reader can see the reasoning rather than trusting
 * the number.
 */
export const recommendationLine = (recommendation: TerritoryRecommendation): string => {
  const percent = Math.round(recommendation.successProbability * 100);
  const target = formatLoopTime(recommendation.targetSeconds);
  const estimate = formatLoopTime(recommendation.estimatedSeconds);
  return `${(recommendation.distanceMetres / 1000).toFixed(1)} km · beat ${target} · you usually run this in about ${estimate} · roughly ${percent}%`;
};

/** The banner shown when a run takes ground. */
export interface CaptureCelebration {
  headline: string;
  detail: string;
  accessibilityLabel: string;
}

export const captureCelebration = (
  claim: TerritoryClaim | undefined,
  takenOverCount: number
): CaptureCelebration => {
  const headline = takenOverCount > 0 ? 'Territory taken' : 'Territory claimed';
  const area = claim ? formatArea(claim.areaSqm) : '';
  const time = claim ? formatLoopTime(claim.durationSeconds) : '';
  const detail = claim
    ? takenOverCount > 0
      ? `${area} · ${time} · beat ${takenOverCount === 1 ? 'the holder' : `${takenOverCount} holders`}`
      : `${area} · ${time} · nobody held it before you`
    : '';
  return { headline, detail, accessibilityLabel: `${headline}. ${detail}` };
};

/** One leaderboard row, worded for a person rather than for a schema. */
export interface LeaderboardRow {
  key: string;
  rankLabel: string;
  name: string;
  detail: string;
  isSelf: boolean;
  accessibilityLabel: string;
}

export const leaderboardRows = (board: TerritoryLeaderboardResponse): LeaderboardRow[] => {
  const render = (entry: TerritoryLeaderboardEntry, beyondPage = false): LeaderboardRow => {
    const name = entry.club?.name ?? entry.owner?.displayName ?? 'RunSphere member';
    const detail =
      board.metric === 'fastest' && entry.fastestSeconds
        ? `${formatLoopTime(entry.fastestSeconds)} · ${formatArea(entry.totalAreaSqm)}`
        : board.metric === 'defended'
          ? `${entry.defendedCount} defended · ${formatArea(entry.totalAreaSqm)}`
          : board.metric === 'claims'
            ? `${entry.claimCount === 1 ? '1 territory' : `${entry.claimCount} territories`}`
            : formatArea(entry.totalAreaSqm);
    // Beyond the page the exact position is unknown, so it is not invented.
    const rankLabel = beyondPage ? '—' : `#${entry.rank}`;
    return {
      key: `${entry.club?.id ?? entry.owner?.id ?? 'row'}-${entry.rank}`,
      rankLabel,
      name: entry.isSelf ? `${name} (you)` : name,
      detail,
      isSelf: entry.isSelf,
      accessibilityLabel: beyondPage
        ? `You, outside the top ${board.entries.length}. ${detail}.`
        : `${rankLabel}. ${entry.isSelf ? 'You' : name}. ${detail}.`
    };
  };
  const rows = board.entries.map((entry) => render(entry));
  return board.self ? [...rows, render(board.self, true)] : rows;
};

/** How an event reads on the map: what it is, and whether it is running. */
export const eventLine = (event: TerritoryEvent, now: Date): string => {
  const starts = Date.parse(event.startsAt);
  const ends = Date.parse(event.endsAt);
  const when =
    now.getTime() < starts
      ? `starts ${event.startsAt.slice(0, 10)}`
      : now.getTime() > ends
        ? 'ended'
        : `ends ${event.endsAt.slice(0, 10)}`;
  const mine =
    event.selfClaimCount > 0
      ? `${event.selfClaimCount} of ${event.heldClaimCount} yours`
      : `${event.heldClaimCount} held`;
  return `${event.title} · ${when} · ${mine}`;
};

/** Events currently worth drawing: announced or running, never ended. */
export const activeEvents = (events: readonly TerritoryEvent[], now: Date): TerritoryEvent[] =>
  events.filter(
    (event) => Date.parse(event.endsAt) >= now.getTime() && event.status !== 'cancelled'
  );

/**
 * Event areas as a map layer, drawn under the territories so an event frames
 * the ground rather than hiding who holds it.
 */
export const eventFeatures = (
  events: readonly TerritoryEvent[]
): FeatureCollection<Polygon, { eventId: string }> => ({
  type: 'FeatureCollection',
  features: events
    .filter((event) => event.boundary.length >= 3)
    .map((event) => ({
      type: 'Feature' as const,
      properties: { eventId: event.id },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[...event.boundary.map(([lng, lat]) => [lng, lat]), [...event.boundary[0]!]]]
      }
    }))
});

/** How much ground a loop returns for the running it costs, in words. */
export const efficiencyLabel = (efficiency: number): string =>
  efficiency >= 0.7
    ? 'a tight loop — a lot of ground for the distance'
    : efficiency >= 0.4
      ? 'a reasonable shape'
      : 'a long way round for the ground it holds';
