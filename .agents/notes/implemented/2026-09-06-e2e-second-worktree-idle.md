# E2E: wait for the second worktree session before its row menu

- date: 2026-09-06
- status: implemented
- scope: tests/e2e

CI failed opening the menu on `harbor-01` (the second worktree): registry
length 2 is true before bind/open, so unblank still hit the first session
and the new row stayed blank (no action buttons). Wait for create-idle
and a bound sessionId. Also raise the keyless test timeout to 300s; the
file-level `setTimeout(180_000)` was overriding playwright.config.
