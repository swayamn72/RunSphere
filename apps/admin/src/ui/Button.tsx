import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Work is in flight: disabled, announced as busy, and never double-submitted. */
  busy?: boolean;
}

/**
 * Defaults to `type="button"` so a button inside a form never submits it by
 * accident; pass `type="submit"` where it should.
 */
export function Button({
  variant = 'primary',
  busy = false,
  type = 'button',
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={['rs-btn', `rs-btn--${variant}`, className].filter(Boolean).join(' ')}
    />
  );
}
