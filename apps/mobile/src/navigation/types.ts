export type Tab = 'Home' | 'Map' | 'Run' | 'Social' | 'Profile';

/**
 * Bottom bar order, left to right.
 *
 * Run sits in the middle because it is the one destination a person reaches
 * mid-stride: the thumb finds the centre without looking, and the two reading
 * surfaces (Home, Map) and the two social surfaces (Social, Profile) flank it.
 */
export const tabs: readonly Tab[] = ['Home', 'Map', 'Run', 'Social', 'Profile'];

/**
 * The tab the app opens on, every launch, and the one a sign-out returns to.
 *
 * Home leads: the dashboard answers "where am I in my week" in one screen —
 * streak, distance, zones, and the challenge that is live right now — which is
 * what somebody opening the app before a run actually wants.
 */
export const landingTab: Tab = 'Home';
