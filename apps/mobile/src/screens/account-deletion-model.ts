import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';

/**
 * Copy and decisions for the in-app account deletion screen (ADR-0012).
 *
 * Deletion is immediate and permanent once the server accepts it, so the
 * screen says exactly that, asks for the password, and tells the runner
 * precisely why a refusal happened: a wrong password is not a network
 * problem, and calling it one would send somebody to retry the wrong thing.
 */

export const DELETION_TITLE = 'Delete your account';

export const DELETION_EXPLANATION =
  'This permanently erases your profile, runs and routes, territory, XP, achievements, friends, clubs, and safety contacts. You will be signed out on every device, and erasure finishes within minutes. It cannot be undone.';

export const DELETION_RETENTION_NOTE =
  'A minimal record that an account was deleted is kept to prevent abuse. Export your data first if you want a copy.';

export const DELETION_DONE_TITLE = 'Account deleted';
export const DELETION_DONE_MESSAGE =
  'Your account is being erased and this phone has been cleared.';

/** The button stays disabled until a password has been typed and nothing is in flight. */
export const canSubmitDeletion = (password: string, submitting: boolean): boolean =>
  !submitting && password.length > 0;

export type DeletionFailure = {
  readonly message: string;
  /** Whether the session is gone, so the screen should hand off to sign-out. */
  readonly sessionExpired: boolean;
};

export const deletionFailure = (error: unknown): DeletionFailure => {
  if (error instanceof AuthFailure) {
    if (error.status === 403)
      return { message: 'That password is not right. Try again.', sessionExpired: false };
    if (error.kind === 'invalid-credentials')
      return {
        message: 'You’ve been signed out. Sign in again to delete your account.',
        sessionExpired: true
      };
    if (error.kind === 'network' || error.kind === 'tls')
      return {
        message: 'TURFR could not be reached. Try again when connected.',
        sessionExpired: false
      };
  }
  if (error instanceof ApiFailure && error.status === 429)
    return { message: 'Too many attempts. Wait a minute and try again.', sessionExpired: false };
  return {
    message: 'Your account could not be deleted right now. Nothing was changed. Try again shortly.',
    sessionExpired: false
  };
};
