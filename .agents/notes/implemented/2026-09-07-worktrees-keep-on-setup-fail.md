# Keep worktree on setup failure

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-worktrees

Create used to drop the git worktree, workspace, and session when
`.worktrees.json` setup failed (`pnpm install` exiting non-zero), then
claim "Nothing was changed". Setup is optional convenience after the
session is already open.

Host `setup()` now throws and leaves the row. The client skips rollback
once `sessions.open` has run, and the dialog uses
`create.setupFailed.*` copy. Invalid JSON at create time still rolls
back (no session yet).
