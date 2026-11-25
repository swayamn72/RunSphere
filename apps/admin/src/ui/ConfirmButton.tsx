import { useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button.js';
import { Dialog } from './Dialog.js';

/**
 * The confirmation for a write that is hard to take back: a dialog that says
 * exactly what will change. Nothing is sent until it is confirmed. Controlled,
 * so a button or a menu item can open it.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onClose,
  onConfirm
}: {
  open: boolean;
  /** The heading, for example "Overturn this sanction?". */
  title: string;
  /** What will happen, in the words the people affected will read. */
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep as it is
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onClose();
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
  );
}

/** A button that opens a `ConfirmDialog` before doing anything. */
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
  title: string;
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
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        danger={danger}
        onClose={() => setOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}
