import type { LocationSample } from './activity-recorder-core';
export const parseSyntheticNdjson = (source: string): LocationSample[] =>
  source
    .trim()
    .split(/\\n|\n/)
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line) as Partial<LocationSample>;
      if (
        typeof value.recordedAt !== 'string' ||
        !Number.isFinite(value.latitude) ||
        !Number.isFinite(value.longitude) ||
        !Number.isFinite(value.accuracy)
      )
        throw new Error('Invalid synthetic location fixture record');
      return {
        recordedAt: value.recordedAt,
        latitude: value.latitude!,
        longitude: value.longitude!,
        accuracy: value.accuracy!,
        altitude: typeof value.altitude === 'number' ? value.altitude : null
      };
    });
export const replaySamples = (
  samples: readonly LocationSample[],
  emit: (sample: LocationSample) => void,
  intervalMs = 500
) => {
  let index = 0;
  const startEpoch = Date.now();
  const timer = setInterval(() => {
    const sample = samples[index];
    if (!sample) return clearInterval(timer);
    const dynamicSample: LocationSample = {
      ...sample,
      recordedAt: new Date(startEpoch + index * 5000).toISOString()
    };
    index++;
    emit(dynamicSample);
  }, intervalMs);
  return () => clearInterval(timer);
};
