import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    pool: 'forks',
    environment: 'jsdom',
    setupFiles: ['../../shared/vitest.setup.ts'],
    // The host suites drive real git repositories (init, commit, worktree add),
    // so the default 5s per-test budget is too tight for the fixtures.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
