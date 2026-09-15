import type { Tab } from './types';

/**
 * Tabs rendered at reduced emphasis. Empty today: every tab in the five-tab
 * bar leads to a surface backed by real data, so none of them needs to be
 * visually hedged.
 */
export const quietTabs: readonly Tab[] = [];

export const tabEmphasis = (tab: Tab): 'primary' | 'quiet' =>
  quietTabs.includes(tab) ? 'quiet' : 'primary';

/**
 * Exhaustive per-tab glyph so a new tab cannot ship without a deliberate icon.
 *
 * Monochrome geometry rather than emoji: the bar tints its active item, and a
 * colour emoji would ignore that tint and read as permanently selected.
 */
export const tabIcons: Record<Tab, string> = {
  Home: '⌂',
  Map: '⬢',
  Run: '▷',
  Social: '◎',
  Profile: '◉'
};
