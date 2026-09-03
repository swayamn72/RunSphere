import { defineConfig } from 'vitest/config';
// Without this the default glob also matches the compiled tests in `dist`, so a
// run after `pnpm build` executes every test twice — once against stale output.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
