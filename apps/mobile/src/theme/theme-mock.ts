import { darkTokens } from '@runsphere/ui';

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
export const themeMock = () => ({
  useAppTheme: () => ({ colorScheme: 'dark' as const, reduceMotion: true, tokens: darkTokens }),
  ThemeProvider: ({ children }: { children: unknown }) => children
});
