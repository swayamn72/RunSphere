import type { ReactNode } from 'react';

/** Says what is missing and what to do about it, in one place. */
export function EmptyState({
  title,
  children,
  action
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rs-empty">
      <p className="rs-empty__title">{title}</p>
      {children ? <p className="rs-empty__body">{children}</p> : null}
      {action ? <div className="rs-empty__action">{action}</div> : null}
    </div>
  );
}
