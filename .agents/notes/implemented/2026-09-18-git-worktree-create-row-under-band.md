# Git panel: the worktree create row sits under the section band

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-git, tests/e2e

The Worktrees section's create row (name field plus Create) moved from the foot
of the section to the first thing under the `Worktrees` band, above the list
and the empty state. Creating a worktree no longer means scrolling past every
checkout: the row is the section's one write and stays reachable as the list
grows, which the old footer placement did not guarantee. The slug-issue line
travels with the field.

## What changed

- `WorktreesSection` renders the row as the section body's first child; a new
  `.formRowTop` modifier carries the body inset above it. `.formRow` keeps
  its footer padding for History's Load more, its only other caller.
- The hint that explains where the checkout lands (`worktrees.openHint`)
  moved with the row: it sits between the field and the list, where it
  explains what Create does, instead of trailing the section as a footnote. It
  carries a `worktrees-hint` marker so the order is testable.
- Enter in the field runs the same create path as the button, following the
  inline-add grammar of `dsh-next-skills` and `dsh-next-cc-plugins`; a
  composition-confirming Enter is ignored so an IME commit never creates a
  worktree. Button and key share one `create()`, so validation and the issue
  line cannot drift apart.
- The dead `.inlineForm` rule was removed; nothing referenced it.
- `tests/client-panel.spec.tsx` pins the order (field, hint, then rows) and
  covers Enter for the valid, invalid and composing cases.
- `packages/dsh-next-git/media/worktrees.webp` was re-captured from the real
  shell through the mount marker.

## Test defect found on the way

The `git` mount marker's grid check measured the status letter of
`src/git-panel/store.ts` — the file the marker had just committed, so by then
it was no longer in the change list. The locator auto-waited for a row that no
longer existed and the smoke hung until the 360s test timeout. It now anchors
on the modified `src/app.ts` row, which stays listed, and asserts that row is
visible before measuring. The assertion landed in 903796a after the README
screenshots were captured, so it had never run green; fixing it is what let the
marker reach the Worktrees capture.

## Verification

- `pnpm --filter @dsh-next/dsh-next-git run typecheck` clean; the package's
  vitest suites (388 tests) pass, including the order and Enter tests.
- The isolated `dsh-next-git` mount marker passes against a real DSH
  0.1.6-alpha.2 shell: stage, commit, worktree create, the grid insets and the
  accordion checks, with host truth read back from disk.
- The full smoke is red in this environment for an unrelated, pre-existing
  reason: `Skills folder-opener supports keyboard, empty-app and error states`
  expects a `VS Code` folder-opener entry this machine does not have (already
  recorded in 2026-09-18-dsh-next-git-source-control.md). It fails before the
  marker loop reaches `dsh-next-git`, which is why the marker was run alone.
