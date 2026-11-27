import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';

/**
 * Password reset and email change (M3.5). Both finish with a token from an
 * emailed link. The link points at a web page that isn't built yet (M3.4), so
 * the app takes the pasted link, or just its code, and reads the token out.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** The token from a pasted link (`…?token=abc`), or a bare code; undefined if neither. */
export const tokenFromPasted = (pasted: string): string | undefined => {
  const text = pasted.trim();
  const inLink = /[?&]token=([A-Za-z0-9_-]{32,})/.exec(text);
  if (inLink) return inLink[1];
  return /^[A-Za-z0-9_-]{32,}$/.test(text) ? text : undefined;
};

export const validEmail = (value: string): boolean => /^\S+@\S+\.\S+$/.test(value.trim());

export const PASSWORD_PROBLEM = {
  short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "Those passwords don't match."
} as const;

export const passwordProblem = (password: string, confirm: string): string | undefined => {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_PROBLEM.short;
  if (password !== confirm) return PASSWORD_PROBLEM.mismatch;
  return undefined;
};

/** Shown after asking, whether or not the address has an account (nothing is confirmed). */
export const RESET_REQUESTED_NOTICE =
  "If that address has a TURFR account, we've emailed a link. It works for an hour.";
export const EMAIL_CHANGE_REQUESTED_NOTICE =
  "We've emailed a link to the new address. Open it there, or paste it here.";
export const BAD_LINK_NOTICE = "That doesn't look like the link or code from the email.";

export const resetFailureMessage = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 400)
    return 'That link has expired or was already used. Ask for a new one.';
  if (error instanceof ApiFailure && error.status === 429)
    return 'Lots of tries just now. Wait a minute, then try again.';
  return failureMessage(error, "Couldn't do that right now. Try again.");
};

export const emailChangeFailureMessage = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 409)
    return "That address can't be used. Try another.";
  return resetFailureMessage(error);
};
