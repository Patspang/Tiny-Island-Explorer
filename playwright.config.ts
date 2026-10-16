import { defineConfig, devices } from '@playwright/test';

// Minimal typing so the app tsconfig doesn't need @types/node.
declare const process: { env: Record<string, string | undefined> };

const PORT = 4173;

// Browser tests run against the production build (`vite preview`) with ?debug,
// which exposes window.__game for state inspection.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 540 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software WebGL so tests run on machines without a GPU (CI, cloud containers).
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
