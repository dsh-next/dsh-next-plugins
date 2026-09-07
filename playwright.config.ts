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
  // One DSH server is shared across the e2e files (e2e-mount.sh). Parallel
  // workers would race sessions and the workspace fixtures.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
  },
})
