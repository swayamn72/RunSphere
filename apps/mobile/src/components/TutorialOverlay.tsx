import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  View,
  findNodeHandle,
  useWindowDimensions
} from 'react-native';
import { Text } from './Text';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
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
import {
  RING_RADIUS,
  bubbleSide,
  bubbleTop,
  needsReveal,
  ringRect
} from '../tutorial-overlay-model';
import { tutorialTargets, type TargetRegistry } from '../tutorial-targets';
import { useAppStyles } from './styles';
import { TourRho, useTypedLine } from './TourRho';

/** Blur only where Android can do it well (12+); elsewhere the panels just dim. */
const blurSupported =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 31);
const GLIDE_MS = 260;
const BLUR_INTENSITY = 24;
// Match expo-blur's Android dark tint where the corners meet the blur panels.
const ANDROID_BLUR_TINT_OPACITY = Math.floor(255 * (BLUR_INTENSITY / 100) * 0.69) / 255;
const AnimatedPath = Animated.createAnimatedComponent(Path);

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
  registry = tutorialTargets,
  blurTarget
}: {
  state: TourState;
  onAction: (action: TourAction) => void;
  activeTab: Tab;
  onShowTab: (tab: Tab) => void;
  registry?: TargetRegistry;
  /**
   * On Android the blur needs to know what to blur: the app shell, wrapped in
   * expo-blur's `BlurTargetView`. Without it the panels just dim.
   */
  blurTarget?: RefObject<View | null>;
}) {
  const styles = useAppStyles();
  const { tokens, reduceMotion } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const screen: Rect = { x: 0, y: 0, width, height };
  const step = tourStep(state);
  // Android blurs only what a BlurTargetView holds; without one, dim instead.
  const canBlur = blurSupported && (Platform.OS !== 'android' || Boolean(blurTarget));
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

  const typed = useTypedLine(step?.rhoLine ?? '', reduceMotion);
  // Found with TalkBack on a phone: Android ignores accessibilityViewIsModal,
  // so each step moves TalkBack's focus to the bubble itself; the app shell
  // behind the tour is hidden from TalkBack by App.tsx.
  const bubbleCopy = useRef<View>(null);
  useEffect(() => {
    if (!step) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(bubbleCopy.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 300);
    return () => clearTimeout(timer);
  }, [step]);
  // A target off screen or under the tab bar is scrolled into view first; until
  // it arrives the bubble sits centred with no ring.
  const hidden = step ? needsReveal(step.targetId, target, screen) : false;
  useEffect(() => {
    if (!hidden || !target) return;
    registry.reveal(target);
    const timer = setTimeout(() => registry.requestMeasure(), 400);
    return () => clearTimeout(timer);
    // Reveal once per step and position, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, step?.id, target?.y]);
  const onScreen = target && !hidden ? target : undefined;
  const ring = onScreen ? ringRect(onScreen, screen) : undefined;
  const x = useSharedValue(ring?.x ?? width / 2);
  const y = useSharedValue(ring?.y ?? height / 2);
  const w = useSharedValue(ring?.width ?? 0);
  const h = useSharedValue(ring?.height ?? 0);
  const pulse = useSharedValue(1);

  // The ring is a fresh object every render, so the glide depends on its
  // numbers rather than the object, or it would restart on each render.
  const ringX = ring?.x;
  const ringY = ring?.y;
  const ringWidth = ring?.width;
  const ringHeight = ring?.height;
  useEffect(() => {
    const to =
      ringX === undefined || ringY === undefined
        ? { x: width / 2, y: height / 2, width: 0, height: 0 }
        : { x: ringX, y: ringY, width: ringWidth ?? 0, height: ringHeight ?? 0 };
    const move = (value: number) =>
      reduceMotion
        ? value
        : withTiming(value, { duration: GLIDE_MS, easing: Easing.out(Easing.cubic) });
    x.value = move(to.x);
    y.value = move(to.y);
    w.value = move(to.width);
    h.value = move(to.height);
  }, [ringX, ringY, ringWidth, ringHeight, width, height, reduceMotion, x, y, w, h]);

  useEffect(() => {
    pulse.value = reduceMotion
      ? 1
      : withRepeat(
          withSequence(withTiming(0.8, { duration: 700 }), withTiming(1, { duration: 700 })),
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
  // The panels leave a rectangular gap. Shade the parts of that gap outside
  // the rounded ring, using the same animated bounds so the edges stay aligned.
  const corners = useAnimatedProps(() => {
    const left = x.value;
    const top = y.value;
    const right = left + w.value;
    const bottom = top + h.value;
    const r = Math.min(RING_RADIUS, w.value / 2, h.value / 2);
    if (r <= 0) return { d: '' };
    return {
      d: `M ${left} ${top} H ${right} V ${bottom} H ${left} Z
          M ${left + r} ${top} H ${right - r} A ${r} ${r} 0 0 1 ${right} ${top + r}
          V ${bottom - r} A ${r} ${r} 0 0 1 ${right - r} ${bottom}
          H ${left + r} A ${r} ${r} 0 0 1 ${left} ${bottom - r}
          V ${top + r} A ${r} ${r} 0 0 1 ${left + r} ${top} Z`
    };
  });
  const ringStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    opacity: pulse.value
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
          intensity={BLUR_INTENSITY}
          tint="dark"
          {...(Platform.OS === 'android'
            ? { blurMethod: 'dimezisBlurViewSdk31Plus' as const, blurTarget }
            : {})}
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
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
        {canBlur && Platform.OS === 'android' ? (
          <AnimatedPath
            animatedProps={corners}
            fill="rgb(25, 25, 25)"
            fillOpacity={ANDROID_BLUR_TINT_OPACITY}
            fillRule="evenodd"
          />
        ) : null}
        <AnimatedPath
          animatedProps={corners}
          fill={canBlur ? tokens.scrim.subtle : tokens.scrim.strong}
          fillRule="evenodd"
        />
      </Svg>
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
        <View
          ref={bubbleCopy}
          accessible
          accessibilityLabel={`${tourProgress(state)}. ${step.title}. ${step.rhoLine}`}
        >
          <View style={styles.tourBubbleRow}>
            <TourRho
              gesture={first || last ? 'wave' : 'point'}
              reduceMotion={reduceMotion}
              size={48}
            />
            <View style={styles.flexCopy}>
              <Text style={styles.eyebrow}>{tourProgress(state).toUpperCase()}</Text>
              <Text accessibilityRole="header" style={styles.tourBubbleTitle}>
                {step.title}
              </Text>
            </View>
          </View>
          <Text style={styles.tourBubbleBody} accessibilityLabel={step.rhoLine}>
            {typed}
            {/* Reserve the whole line so the bubble stays put while Rho talks. */}
            {typed.length < step.rhoLine.length ? (
              <Text style={styles.tourPendingCopy}>{step.rhoLine.slice(typed.length)}</Text>
            ) : null}
          </Text>
        </View>
        <View style={styles.tourButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: first }}
            disabled={first}
            onPress={() => onAction('back')}
            style={styles.tourButton}
          >
            <Text style={[styles.tourButtonLabel, first && styles.tourButtonOff]}>Back</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAction('skip')}
            style={styles.tourButton}
          >
            <Text style={styles.tourButtonLabel}>Skip</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAction('next')}
            style={styles.tourButton}
          >
            <Text style={[styles.tourButtonLabel, styles.tourNext]}>{last ? 'Done' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
