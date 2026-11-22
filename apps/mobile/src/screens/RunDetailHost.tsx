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
import { BackHandler, PanResponder, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { shouldCloseOnDrag, startsCloseDrag, type OpenRun } from './run-detail-model';

/**
 * The run detail overlay (M9 9.16). It sits above the tabs and the tab bar, so
 * opening a run doesn't change tab or lose your place in a list; Android Back
 * or a swipe down closes it and you are where you were.
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
}

export function RunDetailProvider({
  children,
  renderDetail
}: {
  children: ReactNode;
  renderDetail: (props: RunDetailSlotProps) => ReactNode;
}) {
  const { tokens } = useAppTheme();
  const [run, setRun] = useState<OpenRun>();
  const close = useCallback(() => setRun(undefined), []);
  const open = useCallback((next: OpenRun) => setRun(next), []);

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

  return (
    <OpenRunContext.Provider value={open}>
      {children}
      {run ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: tokens.background.canvas }]}
          accessibilityViewIsModal
        >
          {renderDetail({ run, close, dragHandlers: drag.panHandlers })}
        </View>
      ) : null}
    </OpenRunContext.Provider>
  );
}
