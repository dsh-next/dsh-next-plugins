# Preserve worktrees independently of blank sessions

- date: 2026-09-09
- status: implemented
- scope: packages/dsh-next-worktrees

The browser's abandoned-worktree sweeper treated switching away from a blank
session as permission to remove its checkout and host workspace. The mounted
browser regression reproduced a `removeWorktree` call immediately on switching
the current session. This was plugin behavior, not stock Harness session cleanup.

Remove the automatic sweep and its lifecycle wiring. Session disappearance,
archive, reset, and topology refresh must not authorize worktree deletion. Keep
the explicit delete flow and its dirty/setup protections. The bilingual README
now describes this lifecycle; the patch changeset records the user-visible fix.
The mount smoke checks retention across switching and reloading, then explicitly
deletes its fixtures instead of relying on automatic cleanup.

Validation:

- All seven packages pass typecheck, unit tests, and build using their existing
  npm scripts (pnpm run currently attempts an unrelated dependency reinstall).
  Worktrees: 28 test files, 499 cases, including 14 production-entry/browser
  preservation and explicit-delete cases.
- Documentation pairing and i18n checks pass.
- Runtime dependencies pass with a temporary Git index that includes the
  removed source file; the checker otherwise tries to read unstaged deletions.
  The real index is unchanged.
- Real packaged browser smoke: all seven plugins mounted successfully; the
  complete Playwright marker passed in 36.3 seconds. It verifies the unused
  worktree's checkout, registry, and sidebar cluster survive switching and
  reloading, followed by successful explicit deletion. The first run passed
  retention but exposed a wrong clean-delete selector in the new test cleanup;
  correcting that selector made the full lane green.
- No DSH source checkout or current GUI installation was modified.
