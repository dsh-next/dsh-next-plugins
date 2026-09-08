# Nested worktree setup no longer lstats a missing folder

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees

`pnpm install` in `.worktrees.json` failed with `ENOENT lstat` on the nested
worktree path even after the kebab-case folder existed. Host-side install in
that folder succeeds; the GUI path lost the directory while setup ran
(sweeper / parent pnpm workspace walk-up).

Setup now starts as soon as `git worktree add` returns, pins
`NPM_CONFIG_WORKSPACE_DIR` to the worktree, `cd`s there in the shell, refuses
`remove` while the command is in flight, and the sweeper treats that refusal
like a dirty tree. `.dsh/` is gitignored in this repo and locally excluded in
the harbor when missing.
