# Worktrees audit fixes preserve local work and concurrent state

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees

Fixed six audited defects: include copying rejects symlink destinations; sweep
liveness is checkout-wide; deletion preserves concurrent registry updates;
setup state is repository-qualified; Git branch facts refresh from the live
worktree; and stale Create suggestions cannot replace reopened-modal input.
The historical [diagnosis report](../../../docs/archive/2026-09-08-worktrees-bug-diagnosis.md)
owns the original evidence. Its six contracts are now normal package regression
tests, not opt-in diagnostics.
