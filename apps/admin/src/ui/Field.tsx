import type { ReactNode } from 'react';

/**
 * A label wrapped around its control, so the two are always associated. The
 * hint and error sit inside the label, which means a screen reader reads them
 * with the control.
 */
export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="rs-field">
      <span className="rs-field__label">{label}</span>
      {children}
      {hint ? <span className="rs-field__hint">{hint}</span> : null}
      {error ? <span className="rs-field__error">{error}</span> : null}
    </label>
  );
}
