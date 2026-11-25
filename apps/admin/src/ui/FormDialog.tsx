import { useId, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';
import { Notice } from './Notice.js';

/**
 * A create or edit form in a dialog. The submit button sits in the dialog's
 * footer and is tied to the form by `form=`, so Enter in a field submits too.
 * Closing is the caller's call: it closes only once the work succeeded, so a
 * refusal leaves the typed values in place.
 */
export function FormDialog({
  open,
  title,
  submitLabel,
  busy,
  error,
  onClose,
  onSubmit,
  children
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  busy: boolean;
  /** A refusal to show inside the dialog, which covers the page's own notice. */
  error?: string | undefined;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const formId = useId();
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form={formId} busy={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="rs-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {children}
      </form>
    </Dialog>
  );
}
