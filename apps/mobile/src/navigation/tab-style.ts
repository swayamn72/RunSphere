import type { Tab } from './types';

export const quietTabs: readonly Tab[] = ['Season', 'Clubs'];

export const tabEmphasis = (tab: Tab): 'primary' | 'quiet' =>
  quietTabs.includes(tab) ? 'quiet' : 'primary';
