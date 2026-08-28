import { MAX_SAMPLE_ACCURACY_METERS, type LocationSample } from './activity-recorder-core';

export const ACQUISITION_REQUIRED_FIXES = 3;
export const ACQUISITION_TIMEOUT_MS = 30_000;

export interface AcquisitionState {
  readonly startedAtMs: number;
  readonly usableFixes: number;
  readonly status: 'acquiring' | 'ready' | 'timed-out' | 'cancelled';
}

export const startAcquisition = (startedAtMs: number): AcquisitionState => ({
  startedAtMs,
  usableFixes: 0,
  status: 'acquiring'
});

export const acquisitionAcceptsFix = (sample: LocationSample): boolean =>
  sample.accuracy !== null && sample.accuracy >= 0 && sample.accuracy <= MAX_SAMPLE_ACCURACY_METERS;

export const advanceAcquisition = (
  state: AcquisitionState,
  sample: LocationSample,
  nowMs: number
): AcquisitionState => {
  if (state.status !== 'acquiring') return state;
  if (nowMs - state.startedAtMs >= ACQUISITION_TIMEOUT_MS) return { ...state, status: 'timed-out' };
  if (!acquisitionAcceptsFix(sample)) return state;
  const usableFixes = state.usableFixes + 1;
  return {
    ...state,
    usableFixes,
    status: usableFixes >= ACQUISITION_REQUIRED_FIXES ? 'ready' : 'acquiring'
  };
};

export const acquisitionTimeout = (state: AcquisitionState, nowMs: number): AcquisitionState =>
  state.status === 'acquiring' && nowMs - state.startedAtMs >= ACQUISITION_TIMEOUT_MS
    ? { ...state, status: 'timed-out' }
    : state;

export const cancelAcquisition = (state: AcquisitionState): AcquisitionState =>
  state.status === 'acquiring' ? { ...state, status: 'cancelled' } : state;
