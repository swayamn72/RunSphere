import type { Tab } from './types';

export const quietTabs: readonly Tab[] = ['Clubs'];

export const tabEmphasis = (tab: Tab): 'primary' | 'quiet' =>
  quietTabs.includes(tab) ? 'quiet' : 'primary';

/** Exhaustive per-tab glyph so a new tab cannot ship without a deliberate icon. */
export const tabIcons: Record<Tab, string> = {
  Home: '⌂',
  Explore: '⌖',
  Play: '◆',
  Clubs: '◎',
  You: '◉'
};
