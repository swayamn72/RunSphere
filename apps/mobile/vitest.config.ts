import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // voice-copy and theme tests read every screen file; under a full parallel
    // run on Windows they can pass the 5 s default.
    testTimeout: 30_000
  }
});
