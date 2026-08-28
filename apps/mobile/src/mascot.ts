export const mascotVariants = [
  'home',
  'loading',
  'empty',
  'gps-recovery',
  'offline',
  'pending'
] as const;
export type MascotVariant = (typeof mascotVariants)[number];
export type MascotAccessibility =
  { readonly mode: 'decorative' } | { readonly mode: 'meaningful'; readonly label: string };

const authorityTerms =
  /\b(valid|validated|approved|complete|completed|reward|earned|rank|winner|reject|rejected)\b/i;

export const isSafeMascotLabel = (label: string): boolean => !authorityTerms.test(label);

/** Keeps Loop a calm guide rather than an authority, reward, or rejection signal. */
export const mascotPresentation = (
  variant: MascotVariant,
  accessibility: MascotAccessibility,
  reduceMotion: boolean
) => {
  if (accessibility.mode === 'meaningful' && !isSafeMascotLabel(accessibility.label))
    throw new Error('Loop accessibility labels cannot claim authority, rewards, or rejection.');
  return {
    variant,
    accessibility,
    animated: false,
    reducedMotionStatic: reduceMotion,
    accessible: accessibility.mode === 'meaningful',
    accessibilityLabel: accessibility.mode === 'meaningful' ? accessibility.label : undefined
  };
};
