import { buildThemeCss, lightTokens } from '@runsphere/ui';
import type { Plugin } from 'vite';
import { themeBootstrapScript } from './theme-bootstrap.js';

/**
 * Bakes the design tokens into `index.html` so the first paint is already
 * themed, and runs the theme choice before the page paints (ADR-0016). Colours
 * come from `@runsphere/ui`; none are written in this app.
 */
export const runsphereTheme = (): Plugin => ({
  name: 'runsphere-theme',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { name: 'theme-color', content: lightTokens.background.canvas },
      injectTo: 'head-prepend'
    },
    { tag: 'style', attrs: { id: 'rs-theme' }, children: buildThemeCss(), injectTo: 'head' },
    { tag: 'script', children: themeBootstrapScript(), injectTo: 'head' }
  ]
});
