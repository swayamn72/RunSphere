/**
 * Whether Inter registered. Module state rather than context so the drop-in
 * `Text` works anywhere, including in tests that never mount a provider. The
 * theme provider sets it once, before it draws anything, so it never changes
 * while screens are on display.
 */
let interReady = false;

export const isInterReady = (): boolean => interReady;
export const setInterReady = (ready: boolean): void => {
  interReady = ready;
};
