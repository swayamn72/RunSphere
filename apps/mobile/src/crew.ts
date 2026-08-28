import { isSafeMascotLabel, type MascotAccessibility } from './mascot';

export const crewCharacters = ['rho', 'mira', 'coda', 'bram'] as const;

export type CrewCharacter = (typeof crewCharacters)[number];

export interface CrewCharacterMeta {
  readonly name: string;
  readonly role: string;
}

export const crewCharacterMeta: Readonly<Record<CrewCharacter, CrewCharacterMeta>> = {
  rho: { name: 'Rho', role: 'The steady mover - daily walk, run, and hike.' },
  mira: { name: 'Mira', role: 'The scout - quests and checkpoint discovery.' },
  coda: { name: 'Coda', role: 'The connector - friends, challenges, and clubs.' },
  bram: { name: 'Bram', role: 'The trail guardian - hiking and seasonal territory.' }
};

export interface CrewPresentation {
  readonly character: CrewCharacter;
  readonly accessibility: MascotAccessibility;
  readonly animated: false;
  readonly reducedMotionStatic: boolean;
  readonly accessible: boolean;
  readonly accessibilityLabel: string | undefined;
}

/**
 * Keeps the crew calm guides, matching Loop's rule that mascots never claim
 * authority, rewards, or rejection.
 */
export const crewPresentation = (
  character: CrewCharacter,
  accessibility: MascotAccessibility,
  reduceMotion: boolean
): CrewPresentation => {
  if (accessibility.mode === 'meaningful' && !isSafeMascotLabel(accessibility.label)) {
    throw new Error('RunSphere guide labels cannot claim authority, rewards, or rejection.');
  }
  return {
    character,
    accessibility,
    animated: false,
    reducedMotionStatic: reduceMotion,
    accessible: accessibility.mode === 'meaningful',
    accessibilityLabel: accessibility.mode === 'meaningful' ? accessibility.label : undefined
  };
};
