import type { ImageSourcePropType } from 'react-native';
import type { CrewCharacter } from './crew';

/**
 * Swap point for hand-authored vector crew art -> user-provided raster art.
 *
 * To replace a vector prototype with artwork: drop a PNG under
 * `apps/mobile/assets/mascot/crew/` and require() it in the matching entry
 * below. Leave an entry out to keep the built-in vector fallback. See
 * `docs/mascot-assets.md` for filenames and expected dimensions.
 *
 * Entries are `light`/`dark` so the renderer can follow the active theme.
 */
export const crewImageOverrides: Partial<
  Record<CrewCharacter, Readonly<{ light: ImageSourcePropType; dark: ImageSourcePropType }>>
> = {
  // rho: {
  //   light: require('../assets/mascot/crew/crew-rho-light.png'),
  //   dark: require('../assets/mascot/crew/crew-rho-dark.png')
  // },
  // mira: {
  //   light: require('../assets/mascot/crew/crew-mira-light.png'),
  //   dark: require('../assets/mascot/crew/crew-mira-dark.png')
  // },
  // coda: {
  //   light: require('../assets/mascot/crew/crew-coda-light.png'),
  //   dark: require('../assets/mascot/crew/crew-coda-dark.png')
  // },
  // bram: {
  //   light: require('../assets/mascot/crew/crew-bram-light.png'),
  //   dark: require('../assets/mascot/crew/crew-bram-dark.png')
  // }
};
