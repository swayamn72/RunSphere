export type Tab = 'Turf' | 'Home' | 'Explore' | 'Play' | 'Clubs' | 'You';

/**
 * Bottom bar order, left to right (`screens.md` "Tab Structure").
 *
 * Turf is first because it is the surface people open to see what changed
 * while they were away: held ground, lost ground, and time to beat (ADR-0011).
 */
export const tabs: readonly Tab[] = ['Turf', 'Home', 'Explore', 'Play', 'Clubs', 'You'];

/**
 * The tab the app opens on, every launch, and the one a sign-out returns to.
 *
 * Stated once so no screen can reintroduce a dashboard or splash as the first
 * view: `screens.md` requires the Turf map itself to be what a launch shows.
 */
export const landingTab: Tab = 'Turf';
