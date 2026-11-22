import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Dimensions, Keyboard, View, type StyleProp, type ViewStyle } from 'react-native';
import { tutorialTargets, type TargetRegistry } from '../tutorial-targets';

/**
 * Marks something the guided tour can spotlight (M9 9.22). It measures its
 * window rectangle on layout, when the window turns, when the keyboard opens
 * or closes, and whenever the tour asks (a new step, a settled scroll), and
 * reports it to the tour's registry. It renders nothing of its own.
 */
export function TutorialTarget({
  id,
  children,
  style,
  registry = tutorialTargets
}: {
  id: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  registry?: TargetRegistry;
}) {
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    const view = ref.current;
    if (!view?.measureInWindow) return;
    view.measureInWindow((x, y, width, height) => registry.report(id, { x, y, width, height }));
  }, [id, registry]);

  useEffect(() => {
    const stopRequests = registry.onMeasureRequest(measure);
    const turned = Dimensions.addEventListener('change', measure);
    const shown = Keyboard.addListener('keyboardDidShow', measure);
    const hidden = Keyboard.addListener('keyboardDidHide', measure);
    return () => {
      stopRequests();
      turned.remove();
      shown.remove();
      hidden.remove();
      registry.remove(id);
    };
  }, [id, measure, registry]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
}
