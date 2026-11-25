/**
 * What the shell hands every area: the session, the roles that opened it, and
 * `run`, the one place work is wrapped so loading, errors and success notices
 * behave the same everywhere. `run` never throws; a refused call becomes the
 * server's own message on the page.
 */
/** Resolves true when the work succeeded, so a dialog can stay open on a refusal. */
export type Runner = (work: () => Promise<unknown>, success?: string) => Promise<boolean>;

export interface AreaContext {
  accessToken: string;
  roles: readonly string[];
  loading: boolean;
  /** The last refusal, so a dialog can show it where the person is looking. */
  error?: string | undefined;
  run: Runner;
}
