import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAILURE_COPY } from '../failure-copy';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QuestSummary } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { LoopCallout } from '../components/LoopCallout';
import { useLoopGuidance } from '../components/useLoopGuidance';
import type { LoopGuidanceCue } from '../loop-guidance';
import { useAppTheme } from '../theme/theme';
import { dashboardPreviewEnabled, previewTurfQuests } from './dashboard-preview';
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

/**
 * The quest list. A plain list rather than a map with a sheet over it: a quest
 * opens on its own map with just its stops (`QuestDetailScreen`), so a map
 * here would show nothing until one is picked, and the turf map stays turf.
 */
export function ExploreScreen({
  api,
  onSelectQuest,
  onStart,
  onBack,
  onSessionExpired
}: {
  api: MobileApiClient;
  onSelectQuest: (quest: QuestSummary) => void;
  onStart: () => void;
  /**
   * The quest catalogue opens over Home rather than owning a tab, so it needs
   * a way out that is not the tab bar - which is hidden while it is up.
   */
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const { tokens } = useAppTheme();
  const [quests, setQuests] = useState<readonly QuestSummary[]>([]);
  const [catalogState, setCatalogState] = useState<QuestCatalogState>('loading');
  const [filters, setFilters] = useState<QuestFilters>(initialQuestFilters);
  const requestGeneration = useRef(0);

  // Memoised so the mount effect below can depend on it honestly. Both deps
  // are stable for the life of a signed-in session — `onSessionExpired` is a
  // `useCallback` in `App.tsx` keyed on the account — so this reloads the
  // catalog when the account changes and at no other time.
  const load = useCallback(async () => {
    const plan = nextCatalogRequestPlan(requestGeneration.current);
    requestGeneration.current = plan.generation;
    setCatalogState('loading');
    try {
      const next = dashboardPreviewEnabled ? previewTurfQuests : await api.listQuests();
      if (!acceptsCatalogResponse(plan, requestGeneration.current)) return;
      setQuests(next);
      setCatalogState(catalogStateFor(next));
    } catch (error) {
      if (!acceptsCatalogResponse(plan, requestGeneration.current)) return;
      const state = catalogErrorStateFor(error);
      if (state === 'session-expired') onSessionExpired();
      else setCatalogState(state);
    }
  }, [api, onSessionExpired]);
  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  const visibleQuests = filterQuests(quests, filters);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={[
            styles.backButton,
            { backgroundColor: tokens.background.surface, borderColor: tokens.border.subtle }
          ]}
        >
          <Text style={[styles.backGlyph, { color: tokens.text.primary }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.text.primary }]}>
          Quests
        </Text>
      </View>
      <Text style={[styles.copy, { color: tokens.text.secondary }]}>
        Pick a quest to see its stops on a map. Pass every stop on one run to finish it.
      </Text>
      <QuestFiltersBar filters={filters} onChange={setFilters} />
      <QuestCatalog
        state={catalogState}
        quests={visibleQuests}
        hasCatalog={quests.length > 0}
        onRetry={() => void load()}
        onSelectQuest={onSelectQuest}
        onStart={onStart}
      />
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
  // Guidance is resolved before the state branches so the hook order is fixed;
  // an empty catalog is the only case with anything to say.
  const guidanceCandidates = useMemo<readonly LoopGuidanceCue[]>(
    () => (state === 'empty' ? ['quest-empty'] : []),
    [state]
  );
  const guidance = useLoopGuidance(guidanceCandidates);
  if (state === 'loading') return <SheetState title="Loading quests" copy="One moment." />;
  if (state === 'offline')
    return (
      <SheetState
        title="You're offline"
        copy="Quests show once you're back online."
        action="Try again"
        onPress={onRetry}
      />
    );
  if (state === 'configuration')
    return <SheetState title="Explore needs setup" copy="Quests aren't available right now." />;
  if (state === 'error')
    return (
      <SheetState
        title="Quests unavailable"
        copy="Couldn't load quests. You can still start a free run."
        action="Try again"
        onPress={onRetry}
      />
    );
  if (state === 'empty')
    return (
      <>
        <SheetState
          title="No quests here yet"
          copy={FAILURE_COPY.noQuests}
          action="Start a free run"
          onPress={onStart}
        />
        {guidance.cue && <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />}
      </>
    );
  if (!quests.length && hasCatalog)
    return <SheetState title="No quests match these filters" copy="Try another filter." />;
  return (
    <View style={styles.cards} accessibilityRole="list">
      {quests.map((quest) => (
        <Pressable
          key={quest.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${quest.title}`}
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
            {quest.checkpointCount} {quest.checkpointCount === 1 ? 'stop' : 'stops'} ·{' '}
            {quest.openHours.schedule}
            {quest.timeLimitMinutes ? ` · finish within ${quest.timeLimitMinutes} min` : ''}
          </Text>
          <Text style={[styles.select, { color: tokens.action.primary }]}>Open quest</Text>
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
const styles = StyleSheet.create({
  root: { gap: 12 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  backButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  backGlyph: { fontSize: 26, lineHeight: 28 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  copy: { fontSize: 14, lineHeight: 20 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  filter: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12
  },
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
