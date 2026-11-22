import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { BackHandler, PanResponder, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue
} from 'react-native-reanimated';
import { useAppTheme } from '../theme/theme';
import {
  OPEN_SPRING,
  radiusAt,
  rectAt,
  shouldCloseOnDrag,
  startsCloseDrag,
  transitionFrom,
  type OpenRun,
  type Rect
} from './run-detail-model';

/**
 * The run detail overlay (M9 9.16–9.17). It sits above the tabs and the tab
 * bar, so opening a run doesn't change tab or lose your place in a list;
 * Android Back or a swipe down closes it and you are where you were.
 *
 * Opening grows the tapped card into the full screen (position, size and
 * corner radius, on a spring that never overshoots); closing measures the card
 * again, since the list may have moved, and shrinks back into it. A card that
 * is off screen, or couldn't be measured, rises from and falls back below the
 * screen. With reduce motion on, the detail only fades.
 *
 * Screens open a run with `useOpenRun()`. Outside a provider it returns
 * undefined, and run cards simply aren't tappable.
 */

const OpenRunContext = createContext<((run: OpenRun) => void) | undefined>(undefined);

export const useOpenRun = () => useContext(OpenRunContext);

export interface RunDetailSlotProps {
  run: OpenRun;
  close: () => void;
  /** Spread on the part of the detail you drag down to close (the header). */
  dragHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** 0 while still the card, 1 at full screen; cross-fades the thumbnail into the map. */
  progress: SharedValue<number>;
  reduceMotion: boolean;
}

export function RunDetailProvider({
  children,
  renderDetail
}: {
  children: ReactNode;
  renderDetail: (props: RunDetailSlotProps) => ReactNode;
}) {
  const { tokens, reduceMotion } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const [run, setRun] = useState<OpenRun>();
  const progress = useSharedValue(0);
  const from = useSharedValue<Rect>({ x: 0, y: height, width, height });
  const closing = useRef(false);
  const screen = useMemo(() => ({ x: 0, y: 0, width, height }), [width, height]);

  const open = useCallback(
    (next: OpenRun) => {
      closing.current = false;
      from.value = transitionFrom(next.origin, screen);
      progress.value = 0;
      setRun(next);
      progress.value = reduceMotion ? withTiming(1, { duration: 180 }) : withSpring(1, OPEN_SPRING);
    },
    [from, progress, reduceMotion, screen]
  );

  const finishClose = useCallback(() => {
    closing.current = false;
    setRun(undefined);
  }, []);

  const close = useCallback(() => {
    if (!run || closing.current) return;
    closing.current = true;
    const shrink = (origin: Rect | undefined) => {
      from.value = transitionFrom(origin, screen);
      progress.value = withTiming(
        0,
        { duration: reduceMotion ? 150 : 280, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        }
      );
    };
    const measure = run.measureOrigin;
    if (!measure || reduceMotion) shrink(run.origin);
    else
      void measure()
        .catch(() => undefined)
        .then(shrink);
  }, [run, from, progress, reduceMotion, screen, finishClose]);

  useEffect(() => {
    if (!run) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [run, close]);

  const closeRef = useRef(close);
  closeRef.current = close;
  const drag = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => startsCloseDrag(gesture.dy, gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (shouldCloseOnDrag(gesture.dy, gesture.vy)) closeRef.current();
        }
      }),
    []
  );

  const frame = useAnimatedStyle(() => {
    if (reduceMotion)
      return { left: 0, top: 0, width, height, borderRadius: 0, opacity: progress.value };
    const rect = rectAt(from.value, { x: 0, y: 0, width, height }, progress.value);
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      borderRadius: radiusAt(progress.value),
      opacity: 1
    };
  });

  return (
    <OpenRunContext.Provider value={open}>
      {children}
      {run ? (
        <Animated.View
          style={[
            { position: 'absolute', overflow: 'hidden', backgroundColor: tokens.background.canvas },
            frame
          ]}
          accessibilityViewIsModal
        >
          {renderDetail({ run, close, dragHandlers: drag.panHandlers, progress, reduceMotion })}
        </Animated.View>
      ) : null}
    </OpenRunContext.Provider>
  );
}
