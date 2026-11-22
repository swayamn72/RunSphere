import { useEffect, useState } from 'react';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import Svg, { Ellipse, Path, Rect } from 'react-native-svg';
import { useAppTheme } from '../theme/theme';

/**
 * Rho, animated for the guided tour only (M9 9.24; `docs/mascot-assets.md`).
 * The same geometry as `crew-rho-*.svg`, drawn with `react-native-svg` so it
 * can float, blink, and wave or point at the spotlit button. Loop and the crew
 * everywhere else stay static. With reduce motion Rho just fades in, still.
 *
 * Decorative: the bubble's text says everything, so Rho is hidden from
 * screen readers.
 */

export type RhoGesture = 'wave' | 'point';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

export function TourRho({
  gesture,
  reduceMotion,
  size = 64
}: {
  gesture: RhoGesture;
  reduceMotion: boolean;
  size?: number;
}) {
  const { tokens } = useAppTheme();
  const m = tokens.mascot;
  const float = useSharedValue(0);
  const blink = useSharedValue(1);
  const arm = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      float.value = 0;
      blink.value = 1;
      arm.value = 0;
      return;
    }
    float.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 1_100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1_100, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    );
    blink.value = withRepeat(
      withSequence(
        withDelay(2_400, withTiming(0.1, { duration: 90 })),
        withTiming(1, { duration: 120 })
      ),
      -1
    );
    arm.value =
      gesture === 'wave'
        ? withRepeat(
            withSequence(withTiming(-28, { duration: 260 }), withTiming(8, { duration: 260 })),
            3,
            true
          )
        : withTiming(-55, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [gesture, reduceMotion, float, blink, arm]);

  const body = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));
  const armStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${arm.value}deg` }] }));
  const eye = useAnimatedProps(() => ({ ry: 4.2 * blink.value }));
  const scale = size / 112;

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      {...(reduceMotion ? { entering: FadeIn.duration(200) } : {})}
      style={[{ width: size, height: size }, body]}
    >
      <Svg width={size} height={size} viewBox="0 0 112 112">
        <Ellipse cx={56} cy={66} rx={38} ry={29} fill={m.body} stroke={m.outline} strokeWidth={3} />
        <AnimatedEllipse cx={42} cy={60} rx={3.6} fill={m.eye} animatedProps={eye} />
        <AnimatedEllipse cx={70} cy={60} rx={3.6} fill={m.eye} animatedProps={eye} />
        <Path
          d="M40 76 H49 L54 67 L60 86 L65 73 L72 76"
          fill="none"
          stroke={m.beacon}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Rect x={42} y={86} width={14} height={7} rx={3.5} fill={m.outline} />
        <Rect x={58} y={86} width={14} height={7} rx={3.5} fill={m.outline} />
      </Svg>
      {/* The arm pivots at the shoulder, on the body's right edge. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 90 * scale,
            top: 52 * scale,
            width: 6 * scale,
            height: 24 * scale,
            borderRadius: 3 * scale,
            backgroundColor: m.outline,
            transformOrigin: 'top'
          },
          armStyle
        ]}
      />
    </Animated.View>
  );
}

/** How fast the bubble's line types on, in characters per second. */
export const TYPE_RATE = 55;

/**
 * Rho's line typing on. With reduce motion, or once done, it is the whole
 * line. Screen readers get the whole line from the start (see the overlay).
 */
export const useTypedLine = (line: string, reduceMotion: boolean): string => {
  const [shown, setShown] = useState(reduceMotion ? line.length : 0);
  useEffect(() => {
    if (reduceMotion) {
      setShown(line.length);
      return;
    }
    setShown(0);
    const started = Date.now();
    const timer = setInterval(() => {
      const next = Math.min(line.length, Math.ceil(((Date.now() - started) / 1_000) * TYPE_RATE));
      setShown(next);
      if (next >= line.length) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [line, reduceMotion]);
  return line.slice(0, shown);
};
