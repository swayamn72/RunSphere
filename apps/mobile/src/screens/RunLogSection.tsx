import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View as NativeView } from 'react-native';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RunLogItem } from '@runsphere/contracts';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import { failureMessage } from '../failure-copy';
import { runLogEmptyCopy, runWeeks, type RunCard } from './run-log-model';
import type { Rect } from './run-detail-model';

/** One page as either endpoint returns it; `visible` is absent on your own log. */
export interface RunLogPage {
  visible?: boolean;
  data: RunLogItem[];
  nextCursor: string | null;
}

/**
 * The Runs section of a profile (M9 9.15), yours or someone else's. Cards are
 * grouped by week and draw the route as a small SVG line, not a map per row,
 * so a long log stays light. "Show more" loads the next 20.
 */
export function RunLogSection({
  load,
  owner,
  onOpenRun
}: {
  load: (cursor?: string) => Promise<RunLogPage>;
  owner: boolean;
  /**
   * Opens the run's detail (9.16), with where the card is on screen so the
   * detail can grow out of it (9.17). Without it, cards aren't tappable.
   */
  onOpenRun?: (
    item: RunLogItem,
    origin: Rect | undefined,
    measureOrigin: () => Promise<Rect | undefined>
  ) => void;
}) {
  const styles = useAppStyles();
  const [items, setItems] = useState<RunLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'failed'>('loading');
  const [failure, setFailure] = useState<unknown>();
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (after?: string) => {
      const mine = ++generation.current;
      setState(after ? 'more' : 'loading');
      try {
        const page = await load(after);
        if (mine !== generation.current) return;
        setItems((previous) => (after ? [...previous, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setVisible(page.visible ?? true);
        setState('ready');
      } catch (error) {
        if (mine !== generation.current) return;
        setFailure(error);
        setState('failed');
      }
    },
    [load]
  );

  useEffect(() => {
    void fetchPage();
    return () => {
      generation.current += 1;
    };
  }, [fetchPage]);

  const weeks = useMemo(() => runWeeks(items), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  return (
    <View accessibilityLabel="Runs">
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Runs
        </Text>
      </View>
      {state === 'loading' ? <Text style={styles.muted}>Loading runs…</Text> : null}
      {state === 'failed' ? (
        <Pressable accessibilityRole="button" onPress={() => void fetchPage()}>
          <Text style={styles.muted}>
            {`${failureMessage(failure, "Couldn't load runs.")} Tap to try again.`}
          </Text>
        </Pressable>
      ) : null}
      {state === 'ready' && items.length === 0 ? (
        <Text style={styles.muted}>{runLogEmptyCopy(owner, visible)}</Text>
      ) : null}
      {weeks.map((week) => (
        <View key={week.weekStart}>
          <Text accessibilityRole="header" style={styles.runWeekTitle}>
            {week.title.toUpperCase()}
          </Text>
          {week.cards.map((card) => (
            <RunLogCard
              key={card.id}
              card={card}
              {...(onOpenRun
                ? {
                    onPress: (origin, measure) => onOpenRun(byId.get(card.id)!, origin, measure)
                  }
                : {})}
            />
          ))}
        </View>
      ))}
      {cursor && state !== 'loading' ? (
        <Pressable
          accessibilityRole="button"
          disabled={state === 'more'}
          onPress={() => void fetchPage(cursor)}
        >
          <Text style={styles.textButton}>{state === 'more' ? 'Loading…' : 'Show more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The card's rectangle in the window, or undefined if it isn't laid out. */
const measure = (view: NativeView | null): Promise<Rect | undefined> =>
  new Promise((resolve) => {
    if (!view?.measureInWindow) return resolve(undefined);
    view.measureInWindow((x, y, width, height) =>
      resolve(width > 0 && height > 0 ? { x, y, width, height } : undefined)
    );
  });

function RunLogCard({
  card,
  onPress
}: {
  card: RunCard;
  onPress?: (origin: Rect | undefined, measureOrigin: () => Promise<Rect | undefined>) => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const ref = useRef<NativeView>(null);
  const body = (
    <>
      <View style={styles.runThumb}>
        {card.thumbnail ? (
          <Svg width={64} height={64} viewBox="0 0 64 64" accessible={false}>
            <Path
              d={card.thumbnail.path}
              stroke={tokens.action.primary}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Circle
              cx={card.thumbnail.start[0]}
              cy={card.thumbnail.start[1]}
              r={3}
              fill={tokens.status.success}
            />
            <Circle
              cx={card.thumbnail.finish[0]}
              cy={card.thumbnail.finish[1]}
              r={3}
              fill={tokens.text.primary}
            />
          </Svg>
        ) : null}
      </View>
      <View style={styles.flexCopy}>
        <Text style={styles.runCardWhen}>
          {card.badge ? `${card.when} · ${card.badge}` : card.when}
        </Text>
        <Text style={styles.runCardStats}>{`${card.distance} · ${card.time}`}</Text>
        <Text style={styles.runCardMeta}>
          {card.result ? `${card.pace} · ${card.result}` : card.pace}
        </Text>
      </View>
    </>
  );
  return onPress ? (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={card.accessibilityLabel}
      onPress={() => {
        const again = () => measure(ref.current);
        void again().then((origin) => onPress(origin, again));
      }}
      style={styles.runCard}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={card.accessibilityLabel} style={styles.runCard}>
      {body}
    </View>
  );
}
