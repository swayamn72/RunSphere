import { gameWorldFor, type GameWorldPalette } from './game-world';
import { useAppTheme } from './theme';

/**
 * The map palette for the theme showing (ADR-0017: maps follow the app theme).
 * Its own file so `game-world.ts` stays importable from plain Node tests.
 */
export const useGameWorld = (): GameWorldPalette => gameWorldFor(useAppTheme().colorScheme);
