import { useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button.js';
import { Dialog } from './Dialog.js';

/**
 * A button for a write that is hard to take back. Pressing it opens a dialog
 * that says exactly what will change; nothing is sent until that is confirmed.
 */
export function ConfirmButton({
  children,
  variant = 'secondary',
  disabled,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** The dialog's heading, for example "Overturn this sanction?". */
  title: string;
  /** What will happen, in the words the people affected will read. */
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep as it is
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p>{description}</p>
      </Dialog>
    </>
  );
}
