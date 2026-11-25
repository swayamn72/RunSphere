import { useId, type ReactNode } from 'react';

/** A titled block within an area. It is named for assistive tech by its own heading. */
export function Section({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="rs-section" aria-labelledby={headingId}>
      <div className="rs-section__head">
        <div>
          <h2 id={headingId} className="rs-section__title">
            {title}
          </h2>
          {description ? <p className="rs-section__description">{description}</p> : null}
        </div>
        {actions ? <div className="rs-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
