import { darkTokens, lightTokens } from '@runsphere/ui';

/**
 * The theme a render test should stand in for `./theme`.
 *
 * Built from the real `darkTokens` rather than a hand-written subset: a screen
 * that starts reading a new role — a zone hue, a reward tier — would otherwise
 * fail in a test for a missing mock key rather than for anything about the
 * screen, and a colour asserted here is the colour the product actually ships.
 *
 * Usage, from a screen test:
 *
 * ```ts
 * vi.mock('../theme/theme', async () => (await import('../theme/theme-mock.js')).themeMock());
 * ```
 */
export const themeMock = (scheme: 'light' | 'dark' = 'dark') => ({
  useAppTheme: () => ({
    colorScheme: scheme,
    reduceMotion: true,
    tokens: scheme === 'dark' ? darkTokens : lightTokens,
    preference: scheme,
    setPreference: () => undefined,
    // Tests draw in the platform font; Inter is a device concern.
    fontsReady: false
  }),
  ThemeProvider: ({ children }: { children: unknown }) => children,
  ForceTheme: ({ children }: { children: unknown }) => children
});
