import type { Tone } from './ui/index.js';

/**
 * The tone for a lifecycle status. The word is always shown beside it, so this
 * only reinforces: cancelled reads as stopped, finished as done, draft as quiet.
 */
export const lifecycleTone = (status: string): Tone => {
  if (status === 'cancelled') return 'danger';
  if (status === 'draft') return 'neutral';
  if (status === 'finalized' || status === 'sent') return 'success';
  return 'info';
};
