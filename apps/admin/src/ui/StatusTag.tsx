import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** A short state label. The text always says it; colour only reinforces. */
export function StatusTag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`rs-tag rs-tag--${tone}`}>{children}</span>;
}
