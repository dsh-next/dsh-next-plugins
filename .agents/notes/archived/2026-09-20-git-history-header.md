# Match the History section header to Changes and Worktrees

- date: 2026-09-20
- status: archived
- scope: packages/dsh-next-git

History now consumes the existing panel section-band, title, toggle, chevron,
spacer, and icon-button styles instead of its bespoke header styles. Refresh
is icon-only with the existing localized tooltip and accessible name. Loading
uses the shared reduced-motion-aware spinner; loading and busy states still
disable refresh. No Git operations or filter behavior changed.

Regression coverage checks shared header classes, icon-only accessible refresh,
callback separation, disabled states, collapse, and Chinese labels. The package
is private, so no release changeset is needed. Live GUI screenshots and the
full repository/E2E gate remain outstanding; the running GUI was not restarted
or reinstalled.

Validation: Git typecheck, build, and repository i18n check passed. The full Git
suite returned 1,083 passes, one skip, and one RPC inventory timeout (30s).
Rerunning the RPC and final History suites passed all 50 tests, including the
inventory test in 7.2s. Diff whitespace checks passed.
