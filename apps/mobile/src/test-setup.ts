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
    Rect: host('Rect'),
    G: host('G'),
    Defs: host('Defs'),
    LinearGradient: host('LinearGradient'),
    Stop: host('Stop')
  };
});
