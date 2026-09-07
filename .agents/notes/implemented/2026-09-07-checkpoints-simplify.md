# Checkpoints review cleanups

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

After the ledger/live/diffstat work:

- Drop unused `GitPorts.diffNames` / `untracked` / `isWorktree`. Capture seeds
  from `statusNames` only. Preview no longer returns an unused `worktree` flag.
- Live preview reports `turnsShadowed: 0` (unknown indexes do not shadow).
- Snapshot build/project live in `src/host/snapshot.ts`.
- Binary/symlink/other special rows have no Created/Deleted/Modified pill.
- README no longer claims a primary-checkout modal warning.
