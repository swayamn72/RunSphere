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
  const firstAt = Date.parse(samples[0]?.recordedAt ?? '');
  const timer = setInterval(() => {
    const sample = samples[index];
    if (!sample) return clearInterval(timer);
    // Keep the track's own spacing so its speeds are what was recorded. A fixed
    // 5 s step made a 10 s-apart track read as 35 km/h, and the recorder
    // (rightly) refused every step: a synthetic run counted 0 km (found on a
    // phone, M9 9.29). Fixtures without usable times fall back to 5 s.
    const offset =
      Number.isFinite(firstAt) && Number.isFinite(Date.parse(sample.recordedAt))
        ? Date.parse(sample.recordedAt) - firstAt
        : index * 5000;
    const dynamicSample: LocationSample = {
      ...sample,
      recordedAt: new Date(startEpoch + offset).toISOString()
    };
    index++;
    emit(dynamicSample);
  }, intervalMs);
  return () => clearInterval(timer);
};
