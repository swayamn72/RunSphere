export const REPLAY_DURATION_MS = 3_000;

/** Route distance revealed after the given playback time. */
export const easedReplayProgress = (elapsedMs: number): number => {
  const progress = Math.min(1, Math.max(0, elapsedMs / REPLAY_DURATION_MS));
  return progress * (2 - progress);
};

export const formatReplayDistance = (meters: number): string => (meters / 1000).toFixed(2);

export const formatReplayClock = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = (whole % 60).toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};
