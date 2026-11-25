import { useId, type ReactNode } from 'react';

/**
 * The strip above a table: a search box, any filters, and how many rows show.
 * Searching is by the caller (it knows which fields mean anything), so this
 * only holds the controls and announces the count politely.
 */
export function TableToolbar({
  label,
  query,
  onQueryChange,
  shown,
  total,
  children
}: {
  /** Names the search box, for example "Search competitions". */
  label: string;
  query: string;
  onQueryChange: (next: string) => void;
  shown: number;
  total: number;
  /** Filters or other controls that sit beside the search box. */
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="rs-toolbar" role="search">
      <label className="rs-toolbar__search" htmlFor={id}>
        <span className="rs-visually-hidden">{label}</span>
        <input
          id={id}
          type="search"
          value={query}
          placeholder={label}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {children}
      <p className="rs-toolbar__count" aria-live="polite">
        {shown === total ? `${total} shown` : `${shown} of ${total} shown`}
      </p>
    </div>
  );
}
