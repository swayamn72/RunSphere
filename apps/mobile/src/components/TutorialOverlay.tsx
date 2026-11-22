import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import type { Tab } from '../navigation/types';
import type { Rect } from '../screens/run-detail-model';
import { useAppTheme } from '../theme/theme';
import {
  tourProgress,
  tourStep,
  TOUR_STEPS,
  type TourAction,
  type TourState
} from '../tutorial-model';
import { RING_RADIUS, bubbleSide, bubbleTop, ringRect } from '../tutorial-overlay-model';
import { tutorialTargets, type TargetRegistry } from '../tutorial-targets';
import { useAppStyles } from './styles';

/** Blur only where Android can do it well (12+); elsewhere the panels just dim. */
const canBlur =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 31);
const GLIDE_MS = 260;

/**
 * The guided tour's overlay (M9 9.23). Four blurred panels cover the screen
 * around the spotlit button, a rounded ring pulses gently around it, and a
 * speech bubble sits on the side with room. Tapping outside does nothing;
 * Back, Skip and Next are always in the bubble. Moving to the next step
 * glides the ring there, switching tab first when the step is on another tab.
 * With reduce motion the ring jumps and doesn't pulse.
 */
export function TutorialOverlay({
  state,
  onAction,
  activeTab,
  onShowTab,
  rho,
  registry = tutorialTargets
}: {
  state: TourState;
  onAction: (action: TourAction) => void;
  activeTab: Tab;
  onShowTab: (tab: Tab) => void;
  /** Rho, drawn beside the bubble's text (9.24). */
  rho?: ReactNode;
  registry?: TargetRegistry;
}) {
  const styles = useAppStyles();
  const { tokens, reduceMotion } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const screen: Rect = { x: 0, y: 0, width, height };
  const step = tourStep(state);
  const [target, setTarget] = useState<Rect | undefined>(() =>
    step ? registry.rect(step.targetId) : undefined
  );
  const [bubbleHeight, setBubbleHeight] = useState(180);

  useEffect(() => {
    if (!step) return;
    if (step.tab !== activeTab) onShowTab(step.tab);
    setTarget(registry.rect(step.targetId));
    const stop = registry.subscribe(step.targetId, setTarget);
    // The tab may have only just mounted; give it a frame, then measure.
    const timer = setTimeout(() => registry.requestMeasure(), 60);
    registry.requestMeasure();
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [step, activeTab, onShowTab, registry]);

  const ring = target ? ringRect(target, screen) : undefined;
  const x = useSharedValue(ring?.x ?? width / 2);
  const y = useSharedValue(ring?.y ?? height / 2);
  const w = useSharedValue(ring?.width ?? 0);
  const h = useSharedValue(ring?.height ?? 0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    const to = ring ?? { x: width / 2, y: height / 2, width: 0, height: 0 };
    const move = (value: number) =>
      reduceMotion
        ? value
        : withTiming(value, { duration: GLIDE_MS, easing: Easing.out(Easing.cubic) });
    x.value = move(to.x);
    y.value = move(to.y);
    w.value = move(to.width);
    h.value = move(to.height);
  }, [ring?.x, ring?.y, ring?.width, ring?.height, width, height, reduceMotion, x, y, w, h]);

  useEffect(() => {
    pulse.value = reduceMotion
      ? 1
      : withRepeat(
          withSequence(withTiming(1.04, { duration: 700 }), withTiming(1, { duration: 700 })),
          -1
        );
  }, [reduceMotion, pulse]);

  const top = useAnimatedStyle(() => ({ left: 0, top: 0, width, height: y.value }));
  const bottom = useAnimatedStyle(() => ({
    left: 0,
    top: y.value + h.value,
    width,
    height: Math.max(0, height - y.value - h.value)
  }));
  const left = useAnimatedStyle(() => ({ left: 0, top: y.value, width: x.value, height: h.value }));
  const right = useAnimatedStyle(() => ({
    left: x.value + w.value,
    top: y.value,
    width: Math.max(0, width - x.value - w.value),
    height: h.value
  }));
  const ringStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    transform: [{ scale: pulse.value }]
  }));

  if (!step) return null;
  const side = ring ? bubbleSide(ring, screen, bubbleHeight, step.placement) : 'below';
  const bubbleY = ring
    ? bubbleTop(ring, screen, bubbleHeight, side)
    : Math.max(24, (height - bubbleHeight) / 2);
  const last = state !== 'done' && state.index === TOUR_STEPS.length - 1;
  const first = state !== 'done' && state.index === 0;

  const panel = (style: object, key: string) => (
    <Animated.View key={key} pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {canBlur ? (
        <BlurView
          intensity={24}
          tint="dark"
          {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' } : {})}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: canBlur ? tokens.scrim.subtle : tokens.scrim.strong }
        ]}
      />
    </Animated.View>
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      // Taps outside the bubble go nowhere: the tour moves only by its buttons.
      onStartShouldSetResponder={() => true}
    >
      {panel(top, 'top')}
      {panel(bottom, 'bottom')}
      {panel(left, 'left')}
      {panel(right, 'right')}
      {ring ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tourRing,
            { borderRadius: RING_RADIUS, borderColor: tokens.action.primary },
            ringStyle
          ]}
        />
      ) : null}
      <View
        style={[styles.tourBubble, { top: bubbleY }]}
        onLayout={(event) => setBubbleHeight(event.nativeEvent.layout.height)}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.tourBubbleRow}>
          {rho}
          <View style={styles.flexCopy}>
            <Text style={styles.eyebrow}>{tourProgress(state).toUpperCase()}</Text>
            <Text accessibilityRole="header" style={styles.rowTitle}>
              {step.title}
            </Text>
            <Text style={styles.rowDetail}>{step.rhoLine}</Text>
          </View>
        </View>
        <View style={styles.tourButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: first }}
            disabled={first}
            onPress={() => onAction('back')}
          >
            <Text style={[styles.textButton, first && styles.tourButtonOff]}>Back</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onAction('skip')}>
            <Text style={styles.textButton}>Skip</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onAction('next')}>
            <Text style={[styles.textButton, styles.tourNext]}>{last ? 'Done' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
