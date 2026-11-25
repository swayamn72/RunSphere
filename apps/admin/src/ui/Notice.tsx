import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'warning' | 'readonly' | 'danger';

/**
 * A sentence the reader needs, set apart from the page. `danger` is announced
 * immediately; the others are plain notes so they don't interrupt.
 */
export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <p className={`rs-notice rs-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      {children}
    </p>
  );
}
