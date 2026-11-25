/**
 * What the shell hands every area: the session, the roles that opened it, and
 * `run`, the one place work is wrapped so loading, errors and success notices
 * behave the same everywhere. `run` never throws; a refused call becomes the
 * server's own message on the page.
 */
export type Runner = (work: () => Promise<unknown>, success?: string) => Promise<void>;

export interface AreaContext {
  accessToken: string;
  roles: readonly string[];
  loading: boolean;
  run: Runner;
}
