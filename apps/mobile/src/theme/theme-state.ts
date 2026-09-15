/**
 * RunSphere ships one appearance. The type keeps a single member so a screen
 * cannot branch on a scheme that will never arrive, and so removing the branch
 * is a type error rather than dead code.
 */
export type AppColorScheme = 'dark';

/** The product is dark-only; the platform's reported appearance is ignored. */
export const resolveColorScheme = (
  _scheme?: 'dark' | 'light' | 'unspecified' | null
): AppColorScheme => 'dark';
