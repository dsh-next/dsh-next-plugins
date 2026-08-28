---
name: dsh-next-pre-push-checks
description: Run the required checks before pushing or merging dsh-next changes. Use before submitting work in this repository.
---

# dsh-next pre-push checks

Run, in order:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm runtime-deps:check
pnpm docs:check
```

Or run the equivalent mise task alias `mise run ci`. Optionally add the E2E
mount smoke (`mise run e2e`; needs a `dsh` CLI and Playwright Chromium) before
touching mount/loading code.

All must pass before pushing. Fix failures in the same change; do not bypass
the gates by editing package versions manually.
