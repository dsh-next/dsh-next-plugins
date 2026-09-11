# Give notifier POSIX integration tests CI headroom

- date: 2026-09-11
- status: implemented
- scope: packages/dsh-next-notifier/tests/sound-driver.spec.ts

GitHub Actions reported a 5-second timeout in the real WAV generation, decoder-failure, and owned-directory cleanup test. The unchanged test passed locally in 1.45 seconds, so the CI timing failure was not reproduced locally.

Set a 30-second per-test timeout on the generated POSIX programs suite, whose two tests perform real synthesis, decoder subprocesses, and filesystem I/O. Mocked contract tests retain their default timeout; assertions, cleanup, and runtime source are unchanged. No release changeset is needed for this test-only change.

Validation: all 322 notifier tests pass, and the full static `pnpm run check` gate passes (typecheck, all package and script tests, build, runtime dependencies, docs, and i18n). The full keyless browser E2E gate also passes: smoke (2 tests), checkpoints (6 tests), and worktrees-sidebar (1 test). Local pnpm commands use `--config.enableGlobalVirtualStore=false` to match the existing workspace-local dependency installation without changing repository configuration.
