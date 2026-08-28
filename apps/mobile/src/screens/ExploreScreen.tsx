import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LngLat } from '@maplibre/maplibre-react-native';
import type { QuestSummary } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { MapListSheet } from '../maps/MapListSheet';
import { MapSurface } from '../maps/MapSurface';
import type { MapSheetState } from '../maps/map-model';
import { getLocationPermissionState, type LocationPermissionState } from '../location-permission';
import { useAppTheme } from '../theme/theme';
import {
  acceptsCatalogResponse,
  catalogErrorStateFor,
  catalogStateFor,
  filterQuests,
  initialQuestFilters,
  nextCatalogRequestPlan,
  type QuestAccessibilityFilter,
  type QuestCatalogState,
  type QuestFilters,
  type QuestOpenFilter,
  type QuestTimeFilter
} from './explore-model';

export function ExploreScreen({
  api,
  onSelectQuest,
  onStart,
  onSessionExpired
}: {
  api: MobileApiClient;
  onSelectQuest: (quest: QuestSummary) => void;
  onStart: () => void;
  onSessionExpired: () => void;
}) {
  const { tokens } = useAppTheme();
  const [quests, setQuests] = useState<readonly QuestSummary[]>([]);
  const [catalogState, setCatalogState] = useState<QuestCatalogState>('loading');
  const [filters, setFilters] = useState<QuestFilters>(initialQuestFilters);
  const [sheetState, setSheetState] = useState<MapSheetState>('half');
  const [permission, setPermission] = useState<LocationPermissionState>('idle');
  const [recenterBusy, setRecenterBusy] = useState(false);
  const [recenterMessage, setRecenterMessage] = useState<string>();
  const [recenterRequest, setRecenterRequest] = useState<{
    readonly id: number;
    readonly coordinate: LngLat;
  }>();
  const requestGeneration = useRef(0);

  const load = async () => {
    const plan = nextCatalogRequestPlan(requestGeneration.current);
    requestGeneration.current = plan.generation;
    setCatalogState('loading');
    try {
      const next = await api.listQuests();
      if (!acceptsCatalogResponse(plan, requestGeneration.current)) return;
      setQuests(next);
      setCatalogState(catalogStateFor(next));
    } catch (error) {
      if (!acceptsCatalogResponse(plan, requestGeneration.current)) return;
      const state = catalogErrorStateFor(error);
      if (state === 'session-expired') onSessionExpired();
      else setCatalogState(state);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [api]);

  const reconcilePermission = async () => {
    const current = await Location.getForegroundPermissionsAsync();
    setPermission(getLocationPermissionState(current));
  };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcilePermission();
    });
    return () => subscription.remove();
  }, []);

  const requestRecenter = async () => {
    if (recenterBusy || permission === 'blocked') return;
    setRecenterBusy(true);
    setRecenterMessage(undefined);
    try {
      const current = await Location.getForegroundPermissionsAsync();
      const currentState = getLocationPermissionState(current);
      if (currentState === 'blocked') {
        setPermission('blocked');
        return;
      }
      const response =
        currentState === 'granted' ? current : await Location.requestForegroundPermissionsAsync();
      const nextState = getLocationPermissionState(response);
      setPermission(nextState);
      if (nextState !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      setRecenterRequest((currentRequest) => ({
        id: (currentRequest?.id ?? 0) + 1,
        coordinate: [position.coords.longitude, position.coords.latitude]
      }));
    } catch {
      setRecenterMessage(
        'Current location could not be read. Map browsing and the verified list remain available.'
      );
    } finally {
      setRecenterBusy(false);
    }
  };

  const visibleQuests = filterQuests(quests, filters);
  const isList = sheetState === 'list';
  return (
    <View style={styles.root}>
      {!isList && (
        <View style={styles.map} importantForAccessibility="no-hide-descendants">
          <MapSurface
            accessibilityLabel="Explore map. Quest locations are shown only after selecting a quest."
            {...(permission === 'blocked' || recenterBusy
              ? {}
              : { onRequestRecenter: () => void requestRecenter() })}
            recenterEnabled={permission !== 'blocked' && !recenterBusy}
            {...(recenterRequest ? { recenterRequest } : {})}
          />
        </View>
      )}
      <View style={[styles.sheetOverlay, isList && styles.listOverlay]}>
        <MapListSheet state={sheetState} onStateChange={setSheetState} title="Verified quests">
          <View style={styles.content}>
            <Text style={[styles.eyebrow, { color: tokens.status.success }]}>EXPLORE</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: tokens.text.primary }]}>
              Choose from the list
            </Text>
            <Text style={[styles.copy, { color: tokens.text.secondary }]}>
              Browse reviewed public places first. Selecting one loads its checkpoint geometry; this
              catalog does not use your location, pace, or proximity.
            </Text>
            <QuestFiltersBar filters={filters} onChange={setFilters} />
            {permission === 'denied' && (
              <Notice>
                Location was not shared. Recenter can request it again when you choose.
              </Notice>
            )}
            {permission === 'blocked' && <PermissionBlocked />}
            {recenterMessage && <Notice>{recenterMessage}</Notice>}
            <QuestCatalog
              state={catalogState}
              quests={visibleQuests}
              hasCatalog={quests.length > 0}
              onRetry={() => void load()}
              onSelectQuest={onSelectQuest}
              onStart={onStart}
            />
          </View>
        </MapListSheet>
      </View>
    </View>
  );
}

function PermissionBlocked() {
  const { tokens } = useAppTheme();
  return (
    <View style={[styles.notice, { backgroundColor: tokens.background.surfaceInset }]}>
      <Text style={[styles.noticeCopy, { color: tokens.text.secondary }]}>
        Location is blocked for recentering. Browsing and quest details remain available.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open location settings"
        onPress={() => void Linking.openSettings()}
        style={styles.settingsButton}
      >
        <Text style={[styles.settings, { color: tokens.action.primary }]}>Open settings</Text>
      </Pressable>
    </View>
  );
}

function QuestFiltersBar({
  filters,
  onChange
}: {
  filters: QuestFilters;
  onChange: (filters: QuestFilters) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.filters}>
      <FilterTab
        label="All"
        active={filters.open === 'all'}
        onPress={() => onChange({ ...filters, open: 'all' })}
      />
      {(['open', 'limited', 'closed'] as QuestOpenFilter[]).map((status) => (
        <FilterTab
          key={status}
          label={status[0]!.toUpperCase() + status.slice(1)}
          active={filters.open === status}
          onPress={() => onChange({ ...filters, open: status })}
        />
      ))}
      <FilterTab
        label="Under 30 min"
        active={filters.time === 'under-30'}
        onPress={() =>
          onChange({
            ...filters,
            time: filters.time === 'under-30' ? 'all' : ('under-30' as QuestTimeFilter)
          })
        }
      />
      <FilterTab
        label="Step-free"
        active={filters.accessibility === 'step-free'}
        onPress={() =>
          onChange({
            ...filters,
            accessibility:
              filters.accessibility === 'step-free'
                ? 'all'
                : ('step-free' as QuestAccessibilityFilter)
          })
        }
      />
    </View>
  );
}

function FilterTab({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.filter,
        { backgroundColor: tokens.background.surfaceInset, borderColor: tokens.border.subtle },
        active && { backgroundColor: tokens.action.primary, borderColor: tokens.action.primary }
      ]}
    >
      <Text
        style={{ color: active ? tokens.text.onAccent : tokens.text.secondary, fontWeight: '800' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function QuestCatalog({
  state,
  quests,
  hasCatalog,
  onRetry,
  onSelectQuest,
  onStart
}: {
  state: QuestCatalogState;
  quests: readonly QuestSummary[];
  hasCatalog: boolean;
  onRetry: () => void;
  onSelectQuest: (quest: QuestSummary) => void;
  onStart: () => void;
}) {
  const { tokens } = useAppTheme();
  if (state === 'loading')
    return <SheetState title="Loading verified quests" copy="Loading the verified catalog." />;
  if (state === 'offline')
    return (
      <SheetState
        title="You're offline"
        copy="Quest summaries could not refresh. Try again when connected."
        action="Retry catalog"
        onPress={onRetry}
      />
    );
  if (state === 'configuration')
    return (
      <SheetState
        title="Explore needs setup"
        copy="RunSphere needs an API URL before the verified catalog can load."
      />
    );
  if (state === 'error')
    return (
      <SheetState
        title="Verified quests unavailable"
        copy="The map and free activity remain available."
        action="Retry catalog"
        onPress={onRetry}
      />
    );
  if (state === 'empty')
    return (
      <SheetState
        title="No verified quests yet"
        copy="Start a private free activity while the catalog is empty."
        action="Start a free activity"
        onPress={onStart}
      />
    );
  if (!quests.length && hasCatalog)
    return (
      <SheetState
        title="No quests match these filters"
        copy="Try another opening status, accessibility, or active-time band."
      />
    );
  return (
    <View style={styles.cards} accessibilityRole="list">
      {quests.map((quest) => (
        <Pressable
          key={quest.id}
          accessibilityRole="button"
          accessibilityLabel={`Select ${quest.title}`}
          onPress={() => onSelectQuest(quest)}
          style={[
            styles.card,
            { backgroundColor: tokens.background.surfaceInset, borderColor: tokens.border.subtle }
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: tokens.text.primary }]}>{quest.title}</Text>
            <Text style={[styles.status, { color: statusColor(quest.openHours.status, tokens) }]}>
              {quest.openHours.status.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.cardCopy, { color: tokens.text.secondary }]}>
            {(quest.distanceMeters / 1000).toFixed(1)} km · about {quest.estimatedActiveMinutes} min
            · {quest.accessibility}
          </Text>
          <Text style={[styles.cardCopy, { color: tokens.text.secondary }]}>
            {quest.checkpointCount} reviewed checkpoints · {quest.openHours.schedule}
          </Text>
          <Text style={[styles.select, { color: tokens.action.primary }]}>Select quest</Text>
        </Pressable>
      ))}
    </View>
  );
}

const statusColor = (
  status: QuestSummary['openHours']['status'],
  tokens: ReturnType<typeof useAppTheme>['tokens']
) =>
  status === 'open'
    ? tokens.status.success
    : status === 'limited'
      ? tokens.status.warning
      : tokens.status.error;
function SheetState({
  title,
  copy,
  action,
  onPress
}: {
  title: string;
  copy: string;
  action?: string;
  onPress?: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <View style={styles.sheetState} accessibilityLiveRegion="polite">
      <Text style={[styles.cardTitle, { color: tokens.text.primary }]}>{title}</Text>
      <Text style={[styles.copy, { color: tokens.text.secondary }]}>{copy}</Text>
      {action && onPress && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={[styles.actionButton, { backgroundColor: tokens.action.primary }]}
        >
          <Text style={{ color: tokens.text.onAccent, fontWeight: '900' }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}
function Notice({ children }: { children: string }) {
  const { tokens } = useAppTheme();
  return (
    <Text
      style={[
        styles.notice,
        { backgroundColor: tokens.background.surfaceInset, color: tokens.status.warning }
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 560 },
  map: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sheetOverlay: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 250 },
  listOverlay: { top: 0 },
  content: { gap: 10, paddingTop: 8 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { fontSize: 25, fontWeight: '900', letterSpacing: -0.8 },
  copy: { fontSize: 13, lineHeight: 19 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  filter: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  notice: { borderRadius: 12, fontSize: 12, lineHeight: 18, padding: 12 },
  noticeCopy: { flex: 1, fontSize: 12, lineHeight: 18 },
  settingsButton: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' },
  settings: { fontSize: 13, fontWeight: '900' },
  cards: { gap: 8 },
  card: { borderRadius: 16, borderWidth: 1, minHeight: 96, padding: 14 },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between'
  },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '900' },
  status: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  cardCopy: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  select: { fontSize: 13, fontWeight: '900', marginTop: 10 },
  sheetState: { gap: 8, paddingVertical: 8 },
  actionButton: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16
  }
});
