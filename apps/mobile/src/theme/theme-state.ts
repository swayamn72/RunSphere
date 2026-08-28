export type AppColorScheme = 'dark' | 'light';

/** Dark remains the safe default when a platform has not reported its appearance. */
export const resolveColorScheme = (
  scheme: 'dark' | 'light' | 'unspecified' | null | undefined
): AppColorScheme => (scheme === 'light' ? 'light' : 'dark');
