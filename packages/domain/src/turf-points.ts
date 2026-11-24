/**
 * Turf points: how held ground is shown to a runner, everywhere, instead of
 * m², hectares or km². One point is 100 m² of ground, a number a runner can
 * compare at a glance without picturing an area.
 *
 * Display only. Claims, contests and boards are still decided on area in m²;
 * this never rounds a number that decides anything.
 */
export const TURF_POINT_SQM = 100;

/** Whole points held. Any ground at all is at least a fraction of one. */
export const turfPoints = (areaSqm: number): number =>
  Math.floor(Math.max(0, areaSqm) / TURF_POINT_SQM);

/** `3,140`, or `<1` for a sliver of ground, grouped as the app groups numbers (en-IN). */
export const formatTurfPoints = (areaSqm: number): string =>
  areaSqm > 0 && areaSqm < TURF_POINT_SQM ? '<1' : turfPoints(areaSqm).toLocaleString('en-IN');

/** `3,140 Turf points`, `1 Turf point`, `<1 Turf point`. */
export const turfPointsLabel = (areaSqm: number): string => {
  const points = formatTurfPoints(areaSqm);
  return `${points} Turf ${points === '1' || points === '<1' ? 'point' : 'points'}`;
};
