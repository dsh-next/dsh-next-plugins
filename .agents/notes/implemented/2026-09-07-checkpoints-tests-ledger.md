# Checkpoints tests follow the session ledger

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints, tests/e2e

Turn snapshots no longer union git dirty/untracked names. Tests now match
that contract:

- A turn/end snapshot ignores pre-session git dirt; `capture()` still seeds
  git untracked/status for the no-model e2e lane, and those names are
  session intents (not non-agent dirty).
- Deleted rows are cumulative vs session baseline (usually HEAD). A
  session-created file that is later deleted has no net row; a tracked
  file missing from disk still shows `Deleted`.
- The Playwright lane commits the doomed file before deleting it, restores
  tracked fixtures between tests so later `capture()` calls do not absorb
  leftover git status, and asserts Created/Deleted/Modified pills plus
  the Files-header `+N` total.
