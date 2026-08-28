import {
  acquisitionTimeout,
  advanceAcquisition,
  startAcquisition,
  type AcquisitionState
} from './activity-acquisition';
import type { LocationSample } from './activity-recorder-core';

/**
 * Preparation is intentionally in-memory. We create the durable activity row only after this
 * model reaches ready, so denied, cancelled, and timed-out attempts cannot appear in history or
 * recovery. Legacy pre-route rows are discarded during signed-in initialization.
 */
export const beginPreparationAcquisition = (nowMs: number): AcquisitionState =>
  startAcquisition(nowMs);

export const preparationFix = (
  state: AcquisitionState,
  sample: LocationSample,
  nowMs: number
): AcquisitionState => advanceAcquisition(state, sample, nowMs);

export const preparationTimeout = (state: AcquisitionState, nowMs: number): AcquisitionState =>
  acquisitionTimeout(state, nowMs);

export const acquisitionStatusCopy = (state: AcquisitionState): string =>
  `${state.usableFixes} of 3 usable fixes. These checks are not saved as part of your route.`;
