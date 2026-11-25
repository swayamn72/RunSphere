import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal on the browser's own `<dialog>`: focus is trapped, Escape closes it
 * and the page behind it is inert, with nothing to reimplement. `open` is
 * controlled; `onClose` fires for Escape, the close button and a
 * form with `method="dialog"`.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="rs-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="rs-dialog__head">
        <h2 id={titleId} className="rs-dialog__title">
          {title}
        </h2>
        <button type="button" className="rs-dialog__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="rs-dialog__body">{children}</div>
      {footer ? <div className="rs-dialog__footer">{footer}</div> : null}
    </dialog>
  );
}
