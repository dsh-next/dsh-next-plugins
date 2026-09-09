import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // The mount smoke lives in mount.e2e.ts; Playwright's default matcher only
  // picks up *.spec.ts / *.test.ts, so name the e2e extension explicitly or
  // the lane silently discovers zero files.
  testMatch: /.*\.e2e\.ts/,
  // One test drives every plugin marker; the cc-plugins marker walks several
  // install/refresh flows through the real GUI, which needs well over the
  // 30s default.
  timeout: 300_000,
  // Each spec group owns a fresh runtime; tests within it share fixtures.
  // Parallel workers would race sessions and workspace mutations.
  workers: 1,
  fullyParallel: false,
  // The orchestrator retries whole suites against fresh runtimes.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
