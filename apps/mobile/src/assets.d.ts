/**
 * Static image imports. Metro resolves these to an asset id (a number) and
 * Vitest to a URL string; both are valid `Image` sources, so screens can use
 * an ES `import` instead of `require()`.
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
