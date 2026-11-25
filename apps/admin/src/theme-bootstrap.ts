import { THEME_STORAGE_KEY } from './theme.js';

/**
 * The inline script that runs in `<head>`, after the theme stylesheet and
 * before first paint, so the page never flashes the wrong theme. It mirrors
 * `applyThemeToDocument` in `theme.ts` and a test keeps the two in step. Any
 * failure leaves the page on light, the default.
 */
export const themeBootstrapScript = (): string =>
  `(function(){var r=document.documentElement;try{` +
  `var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(p!=='dark'&&p!=='system')p='light';` +
  `var d=p==='dark'||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);` +
  `r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-preference',p);` +
  `var m=document.querySelector('meta[name="theme-color"]');` +
  `if(m){var c=getComputedStyle(r).getPropertyValue('--rs-background-canvas').trim();if(c)m.setAttribute('content',c);}` +
  `}catch(e){r.setAttribute('data-theme','light');}})();`;
