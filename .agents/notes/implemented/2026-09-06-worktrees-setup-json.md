# .worktrees.json setup commands

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees

Create reads `.dsh/worktrees.json` then `.worktrees.json` at the git
primary. Cursor-shaped keys (`setup-worktree`, `-unix`, `-windows`):
command arrays or a relative script. `$ROOT_WORKTREE_PATH` is the main
checkout. Failure rolls back the new worktree.
