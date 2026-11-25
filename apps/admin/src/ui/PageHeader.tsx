import type { ReactNode } from 'react';

/** The title block at the top of an area. The one `h1` on the page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rs-page-header">
      <div className="rs-page-header__text">
        {eyebrow ? <p className="rs-eyebrow">{eyebrow}</p> : null}
        <h1 className="rs-page-header__title">{title}</h1>
        {description ? <p className="rs-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="rs-page-header__actions">{actions}</div> : null}
    </div>
  );
}
