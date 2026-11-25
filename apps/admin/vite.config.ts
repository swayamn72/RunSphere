import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { runsphereTheme } from './src/theme-plugin.js';

export default defineConfig({
  plugins: [react(), runsphereTheme()],
  // Playwright specs live in e2e/ and run with `pnpm test:e2e`, not here.
  test: { include: ['src/**/*.test.{ts,tsx}'] },
  server: { host: '0.0.0.0', allowedHosts: true, port: 4173 }
});
