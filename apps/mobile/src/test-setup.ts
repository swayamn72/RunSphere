// Mock image asset requires in Vitest Node environment
if (typeof require !== 'undefined' && require.extensions) {
  require.extensions['.png'] = (module) => {
    module.exports = 1;
  };
  require.extensions['.jpg'] = (module) => {
    module.exports = 1;
  };
  require.extensions['.webp'] = (module) => {
    module.exports = 1;
  };
}

// react-native-svg ships Flow-typed sources Node can't parse. Screens that draw
// a route line render it as plain host elements here; a test that inspects the
// drawing mocks it itself (see RunLogSection.render.test.tsx).
import { vi } from 'vitest';
vi.mock('react-native-svg', async () => {
  const React = await import('react');
  const host =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name, props, children as never);
  return {
    default: host('Svg'),
    Svg: host('Svg'),
    Path: host('Path'),
    Circle: host('Circle'),
    Line: host('Line'),
    Ellipse: host('Ellipse'),
    Rect: host('Rect'),
    G: host('G'),
    Defs: host('Defs'),
    LinearGradient: host('LinearGradient'),
    Stop: host('Stop')
  };
});

// Reanimated needs its native module. In Node, shared values are plain boxes,
// animations jump straight to their end value (calling the completion back),
// and Animated.View is a host element, so render tests see the final layout.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react');
  const host =
    (name: string) =>
    ({ children, entering: _entering, ...props }: Record<string, unknown>) =>
      React.createElement(name, props, children as never);
  const finish = (value: unknown, _config?: unknown, done?: (finished: boolean) => void) => {
    done?.(true);
    return value;
  };
  const chain: Record<string, unknown> = {};
  for (const method of ['delay', 'duration', 'springify', 'withInitialValues', 'reduceMotion'])
    chain[method] = () => chain;
  const Animated = {
    View: host('Animated.View'),
    ScrollView: host('Animated.ScrollView'),
    createAnimatedComponent: (component: unknown) => component
  };
  return {
    default: Animated,
    ...Animated,
    useSharedValue: (value: unknown) => React.useRef({ value }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    useAnimatedReaction: () => undefined,
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedScrollHandler: () => () => undefined,
    withSpring: finish,
    withTiming: finish,
    withDelay: (_ms: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values.at(-1),
    cancelAnimation: () => undefined,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    interpolate: (value: number, input: number[], output: number[]) =>
      output[0]! + ((value - input[0]!) / (input[1]! - input[0]!)) * (output[1]! - output[0]!),
    Extrapolation: { CLAMP: 'clamp' },
    Easing: {
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      cubic: (t: number) => t,
      sin: (t: number) => t,
      linear: (t: number) => t
    },
    FadeInDown: chain,
    FadeIn: chain,
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' }
  };
});
vi.mock('expo-blur', async () => {
  const React = await import('react');
  return {
    BlurView: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('BlurView', props, children as never),
    BlurTargetView: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('BlurTargetView', props, children as never)
  };
});
vi.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn
}));
