---
name: dsh-next-pre-push-checks
description: Run the required checks before pushing or merging dsh-next changes. Use before submitting work in this repository.
---

# dsh-next pre-push checks

Run the canonical full gate:

```sh
mise run ci
# equivalent: pnpm run ci
```

This runs `pnpm run check` (ordered typecheck, test, build, runtime-deps,
docs, i18n), then `pnpm run test:e2e` (all keyless browser suites).
`pnpm test` includes package unit tests and repository script tests;
`pnpm run test:unit` runs only package tests.

For static-only iteration, use `mise run check`. For focused browser work,
use `mise run e2e -- smoke`, `checkpoints`, or `worktrees-sidebar`,
but do not substitute focused coverage for the full pre-push gate.

Install the pinned DSH CLI and Chromium and run `mise run doctor` as described
in CONTRIBUTING.md. E2E owns a fresh runtime per suite attempt; it never
restarts a user profile. Keyless runs use fake credentials, not an offline
network guarantee. Live-model tests are separately opt-in with
`mise run e2e-live -- checkpoints` and can spend credits.

All gates must pass before pushing. Inspect the per-run results and failure
artifacts under `artifacts/testing`. Fix failures in the same change; never
bypass gates by changing package versions, weakening guards, or reusing
polluted fixtures. See the local-testing skill for runtime ownership and
private credential handling.
